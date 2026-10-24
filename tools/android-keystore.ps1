# -----------------------------------------------------------------------------
#  Android upload keystore oluşturur (yalnızca yoksa).
#
#  ÖNEMLİ: Bu dosya ve .jks uzantılı anahtar KAYBOLURSA Play Store'daki
#  uygulamayı aynı anahtarla güncelleyemezsiniz. Yedekleyin!
# -----------------------------------------------------------------------------
param([switch]$Force)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$keyDir = Join-Path (Split-Path -Parent $root) 'android-keys'
$backupDir = Join-Path $env:LOCALAPPDATA 'dd-android'
New-Item -ItemType Directory -Force $keyDir | Out-Null
New-Item -ItemType Directory -Force $backupDir | Out-Null

$ks = Join-Path $keyDir 'deneyap-upload.jks'
$alias = 'deneyap'
$infoPath = Join-Path $keyDir 'KEYSTORE-INFO.txt'
$propsPath = Join-Path $root 'android\keystore.properties'

if ((Test-Path $ks) -and !$Force) {
    Write-Host "Keystore zaten var: $ks" -ForegroundColor Yellow
    if (Test-Path $infoPath) { Get-Content $infoPath | Write-Host }
    Write-Host "Yeni anahtar üretmek için -Force kullanın (MEVCUT UYGULAMA GÜNCELLEMELERİNİ BOZAR)." -ForegroundColor Red
    exit 0
}

if ((Test-Path $ks) -and $Force) {
    $bak = "$ks.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Move-Item $ks $bak
    Write-Host "Eski keystore yedeklendi: $bak" -ForegroundColor Yellow
}

$javaHome = $env:JAVA_HOME
if (!(Test-Path (Join-Path $javaHome 'bin\keytool.exe'))) {
    $javaHome = 'C:\Users\mabil\.jdks\jbr-17.0.14'
}
$keytool = Join-Path $javaHome 'bin\keytool.exe'
if (!(Test-Path $keytool)) { throw "keytool bulunamadı. JAVA_HOME ayarlayın." }

$chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
$pass = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })

& $keytool -genkeypair -v -keystore $ks -alias $alias -keyalg RSA -keysize 4096 -validity 10000 -storetype PKCS12 -storepass $pass -keypass $pass -dname "CN=Deneyap Ev Koruma, OU=Mobile, O=mabiltekin, L=Istanbul, ST=Istanbul, C=TR" 2>&1 | Write-Host
if ($LASTEXITCODE -ne 0) { throw "keytool başarısız ($LASTEXITCODE)" }

$out = & $keytool -list -v -keystore $ks -alias $alias -storepass $pass 2>&1 | Out-String
$fp = [regex]::Match($out, 'SHA256:\s*([0-9A-Fa-f:]+)').Groups[1].Value.ToUpperInvariant()
if (!$fp) { throw "Parmak izi okunamadı.`n$out" }

$info = @"
DENEYAP EV KORUMA - ANDROID UPLOAD KEY
=====================================
Keystore : $ks
Alias    : $alias
Store/key password: $pass
SHA-256  : $fp
Created  : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

BU DOSYAYI VE .jks DOSYASINI YEDEKLEYIN.
Google Play'e ilk yuklemeden sonra Play Console > Setup > App signing
bolumundeki SHA-256 parmak izini de pwa/.well-known/assetlinks.json
dosyasina ekleyin.
"@
[System.IO.File]::WriteAllText($infoPath, $info, (New-Object System.Text.UTF8Encoding($false)))
Copy-Item $ks (Join-Path $backupDir 'deneyap-upload.jks') -Force
Copy-Item $infoPath (Join-Path $backupDir 'KEYSTORE-INFO.txt') -Force

$props = @"
storeFile=$(($ks -replace '\\', '/'))
storePassword=$pass
keyAlias=$alias
keyPassword=$pass
"@
[System.IO.File]::WriteAllText($propsPath, $props, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Keystore hazır: $ks" -ForegroundColor Green
Write-Host "SHA-256: $fp" -ForegroundColor Green
Write-Host ""
Write-Host "Şimdi pwa/.well-known/assetlinks.json ve" -ForegroundColor Yellow
Write-Host "android/app/src/main/res/values/strings.xml içindeki parmak izini" -ForegroundColor Yellow
Write-Host "yukarıdaki SHA-256 ile güncelleyin." -ForegroundColor Yellow
