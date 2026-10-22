#Requires -Version 5.1
<#
.SYNOPSIS
  Firmware derleme (ve istenirse yukleme) yardimcisi - Arduino IDE'nin
  arduino-cli'sini kullanir.

.DESCRIPTION
  Neden bu script gerekli?

  1) KUTUPHANE YOLU: Bu makinede Arduino kutuphaneleri ASCII olmayan bir yolda
     durabilir (or. C:\Users\<kullanici>\OneDrive\<yerellesmis Belgeler>\
     Arduino\libraries). ESP32 derleyicisi (xtensa gcc) bu yolu acamaz ve su
     hatayi verir:
        fatal error: PubSubClient.h: No such file or directory
     Script kutuphaneleri gecici bir ASCII klasore kopyalar ve arduino-cli'ye
     --library ile acikca verir. Boylece derleme calisir.

  2) SKETCH ADI: Arduino kurali geregi sketch klasor adi .ino adiyla AYNI
     olmalidir. Iki sketch de buna uygundur:
        firmware/firmware.ino
        firmware-mqtt/DeneyapEvKoruma/DeneyapEvKoruma.ino

  3) Servo.h ESP32 cekirdegi 3.x'te yoktur; iki firmware de servo PWM'ini
     yerlesik LEDC ile uretir (harici kutuphane gerekmez).

.PARAMETER Target
  mqtt   -> MQTT firmware (firmware-mqtt/DeneyapEvKoruma)  [aktif firmware]
  legacy -> HTTP/AP firmware (firmware)                    [eski firmware]
  both   -> ikisi de

.PARAMETER Upload
  Derlemeden sonra karta yukler. -Port verilmelidir.

.PARAMETER UploadNetwork
  Derlemeden sonra KABLOSUZ (OTA) yukler. Kartin IP adresini alir; OTA
  sifresi/portu hedefin config.h dosyasindan (OTA_PASSWORD / OTA_PORT) okur.
  Kartin OTA destekli bir firmware ile bir kez USB'den yuklenmis olmasi gerekir.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-firmware.ps1 -Target mqtt
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-firmware.ps1 -Target mqtt -Upload -Port COM5
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-firmware.ps1 -Target mqtt -UploadNetwork 192.168.1.50
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-firmware.ps1 -Target both
#>
param(
  [ValidateSet('mqtt', 'legacy', 'both')]
  [string]$Target = 'both',

  [string]$FqbnMqtt   = 'esp32:esp32:deneyapkart1Av2',
  [string]$FqbnLegacy = 'esp32:esp32:deneyapkartv2',

  # Arduino kutuphane klasoru. Bos birakilirsa "Belgeler\Arduino\libraries"
  # (yonlendirilmis/yerellesmis adiyla) bulunur.
  [string]$UserLib = '',

  [switch]$Upload,
  [string]$Port = '',

  # Kablosuz (OTA) yukleme: kartin IP adresi verilir. Sifre ve port, hedefin
  # config.h dosyasindan (OTA_PASSWORD / OTA_PORT) okunur.
  #   npm run fw:ota -- 192.168.4.1
  #   npm run fw:ota:legacy -- 192.168.4.1
  [string]$UploadNetwork = '',
  [string]$OtaPassword = '',
  [int]$OtaPort = 0,

  # Ayrintili derleme ciktisi (uyarilar dahil)
  [switch]$ShowWarnings
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Find-ArduinoCli {
  $cmd = Get-Command arduino-cli -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    'C:\Program Files\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe',
    'C:\Program Files (x86)\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe')
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  throw "arduino-cli bulunamadi. Arduino IDE'yi kurun veya arduino-cli'yi PATH'e ekleyin."
}

# ESP32 cekirdegiyle gelen espota.exe (OTA yukleyici). Python gerekmez.
# Birden fazla cekirdek surumu varsa en yenisi secilir.
function Find-Espota {
  $roots = @(
    (Join-Path $env:LOCALAPPDATA 'Arduino15\packages\esp32\hardware\esp32'),
    (Join-Path $env:USERPROFILE 'AppData\Local\Arduino15\packages\esp32\hardware\esp32')
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    $hit = Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName 'tools\espota.exe' } |
      Where-Object { Test-Path $_ } |
      Select-Object -First 1
    if ($hit) { return $hit }
  }
  throw "espota.exe bulunamadi (esp32 cekirdegi kurulu mu?)."
}

# config.h icinden #define <Key> "deger" / #define <Key> 3232 okur.
function Get-OtaField {
  param([string]$ConfigPath, [string]$Key)
  if (-not $ConfigPath -or -not (Test-Path $ConfigPath)) { return '' }
  $desen = '^\s*#define\s+' + $Key + '\s+"?([^"\r\n]+?)"?\s*(//.*)?$'
  $m = Select-String -Path $ConfigPath -Pattern $desen | Select-Object -First 1
  if ($m) { return $m.Matches[0].Groups[1].Value.Trim() }
  return ''
}

function Resolve-UserLib {  if ($UserLib) { return $UserLib }
  $docs = [Environment]::GetFolderPath('MyDocuments')   # yonlendirilmis/yerellesmis yol
  $p = Join-Path $docs 'Arduino\libraries'
  if (Test-Path $p) { return $p }
  $p2 = Join-Path $env:USERPROFILE 'Documents\Arduino\libraries'
  if (Test-Path $p2) { return $p2 }
  return ''
}

# Kutuphaneleri ASCII bir klasore kopyalar (derleyici ASCII olmayan yolu acamiyor).
# NOT: Kaynak OneDrive altinda olabilir; "bulut" yer tutucu dosyalar ilk
# erisimde indirilir ve zaman asimina ugrayabilir. Bu yuzden dosya dosya
# kopyalanir, hata halinde birkac kez denenir ve tek bir dosya yuzunden
# tum islem durdurulmaz.
function Stage-Libraries {
  param([string]$SourceDir)
  if (-not $SourceDir -or -not (Test-Path $SourceDir)) { return @() }
  $dst = Join-Path $env:TEMP 'dd-arduino-libs'
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  New-Item -ItemType Directory -Force $dst | Out-Null

  $out = @()
  foreach ($dir in (Get-ChildItem $SourceDir -Directory -ErrorAction SilentlyContinue)) {
    $target = Join-Path $dst $dir.Name
    New-Item -ItemType Directory -Force $target | Out-Null
    $ok = 0
    $bad = 0
    $files = @(Get-ChildItem $dir.FullName -Recurse -File -ErrorAction SilentlyContinue)
    foreach ($f in $files) {
      $rel  = $f.FullName.Substring($dir.FullName.Length).TrimStart('\')
      $dest = Join-Path $target $rel
      $destDir = Split-Path $dest -Parent
      if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force $destDir | Out-Null }
      $copied = $false
      for ($try = 1; $try -le 3 -and -not $copied; $try++) {
        try {
          Copy-Item $f.FullName $dest -Force -ErrorAction Stop
          $copied = $true
        } catch {
          Start-Sleep -Milliseconds (400 * $try)
        }
      }
      if ($copied) { $ok++ } else { $bad++ }
    }
    if ($bad -gt 0) {
      Write-Host ("  ! " + $dir.Name + ": $bad dosya kopyalanamadi ($ok tamam)") -ForegroundColor Yellow
    }
    if ($ok -gt 0) { $out += $target }
  }
  return $out
}

$cli  = Find-ArduinoCli
$libs = Resolve-UserLib
Write-Host ""
Write-Host "arduino-cli : $cli"
Write-Host "kutuphane   : $libs"

$staged = @()
if ($libs -and $libs -match '[^\x00-\x7F]') {
  Write-Host "  -> yol ASCII disi karakter iceriyor; gecici ASCII klasore kopyalaniyor" -ForegroundColor Yellow
  $staged = Stage-Libraries -SourceDir $libs
  Write-Host "  -> $($staged.Count) kutuphane hazirlandi: $env:TEMP\dd-arduino-libs" -ForegroundColor Yellow
} elseif ($libs) {
  $staged = @(Get-ChildItem $libs -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
}

$libArgs = @()
foreach ($l in $staged) { $libArgs += @('--library', $l) }

$sketches = @()
if ($Target -eq 'mqtt' -or $Target -eq 'both') {
  $sketches += @{
    Name   = 'MQTT (aktif)'
    Path   = (Join-Path $root 'firmware-mqtt\DeneyapEvKoruma')
    Fqbn   = $FqbnMqtt
    Config = (Join-Path $root 'firmware-mqtt\DeneyapEvKoruma\config.h')
  }
}
if ($Target -eq 'legacy' -or $Target -eq 'both') {
  $sketches += @{
    Name   = 'HTTP/AP (eski)'
    Path   = (Join-Path $root 'firmware')
    Fqbn   = $FqbnLegacy
    Config = (Join-Path $root 'firmware\config.h')
  }
}

if ($UploadNetwork -and $sketches.Count -ne 1) {
  Write-Host ""
  Write-Host "! OTA icin tek hedef secin: -Target mqtt  veya  -Target legacy" -ForegroundColor Red
  Write-Host "  (ornek: npm run fw:ota -- 192.168.4.1)" -ForegroundColor Yellow
  exit 1
}

$failed = 0
foreach ($s in $sketches) {
  Write-Host ""
  Write-Host ("=== " + $s.Name + " - " + $s.Fqbn + " ===") -ForegroundColor Cyan
  if (-not (Test-Path $s.Path)) {
    Write-Host "  ! sketch klasoru yok: $($s.Path)" -ForegroundColor Red
    $failed++
    continue
  }

  $cliArgs = @('compile', '--fqbn', $s.Fqbn)
  $cliArgs += $libArgs
  if ($ShowWarnings) { $cliArgs += @('--warnings', 'all') }

  # OTA'da .bin dosyasi gerekiyor: derleme ciktisini bilinen bir klasore al.
  $buildPath = ''
  if ($UploadNetwork) {
    $buildPath = Join-Path $env:TEMP ('dd-fw-ota-' + ($s.Fqbn -replace '[:]', '-'))
    if (Test-Path $buildPath) { Remove-Item $buildPath -Recurse -Force }
    New-Item -ItemType Directory -Force $buildPath | Out-Null
    $cliArgs += @('--build-path', $buildPath)
  }

  $cliArgs += $s.Path
  if ($Upload) {
    if (-not $Port) {
      Write-Host "  ! -Upload icin -Port COMx gerekli" -ForegroundColor Red
      $failed++
      continue
    }
    $cliArgs += @('--upload', '-p', $Port)
  }

  & $cli @cliArgs
  if ($LASTEXITCODE -ne 0) {
    $failed++
    continue
  }
  Write-Host "  OK: derlendi" -ForegroundColor Green

  if ($Upload) { Write-Host "  OK: yuklendi ($Port)" -ForegroundColor Green }

  # OTA
  if ($UploadNetwork) {
    $binAdi = (Split-Path $s.Path -Leaf) + '.ino.bin'
    $bin = Join-Path $buildPath $binAdi
    if (-not (Test-Path $bin)) {
      Write-Host ("  ! .bin bulunamadi: " + $bin) -ForegroundColor Red
      $failed++
      continue
    }

    $sifre = $OtaPassword
    if (-not $sifre) { $sifre = Get-OtaField -ConfigPath $s.Config -Key 'OTA_PASSWORD' }
    if (-not $sifre) {
      Write-Host "  ! OTA_PASSWORD bos (config.h) - kablosuz yukleme yapilamaz" -ForegroundColor Red
      $failed++
      continue
    }

    $portNo = $OtaPort
    if (-not $portNo) {
      $p = Get-OtaField -ConfigPath $s.Config -Key 'OTA_PORT'
      if ($p) { $portNo = [int]$p }
    }
    if (-not $portNo) { $portNo = 3232 }

    $espota = Find-Espota
    Write-Host ("  OTA: " + $UploadNetwork + ":" + $portNo + "  (" + $binAdi + ")") -ForegroundColor Cyan
    & $espota -i $UploadNetwork -p $portNo -a "$sifre" -f $bin
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  ! OTA yuklemesi basarisiz (kart acik mi, ayni agda mi, sifre dogru mu?)" -ForegroundColor Red
      $failed++
    } else {
      Write-Host "  OK: kablosuz yuklendi (kart yeniden basliyor)" -ForegroundColor Green
    }
  }
}

Write-Host ""
if ($failed -eq 0) {
  Write-Host "TAMAM" -ForegroundColor Green
  exit 0
} else {
  Write-Host "$failed hedef basarisiz" -ForegroundColor Red
  exit 1
}
