# -----------------------------------------------------------------------------
#  Deneyap Ev Koruma - Android APK / AAB üretimi
#
#  Kullanım:
#    npm run android:apk
#    npm run android:aab
#    npm run android:all
#    powershell -ExecutionPolicy Bypass -File tools/build-android.ps1 -Target apk -Install
#
#  Not: Proje yolu boşluk/Türkçe karakter içerdiği için derleme ASCII bir
#  kopyada (C:\dd-android-build\project) yapılır; çıktılar android\dist'e
#  kopyalanır.
# -----------------------------------------------------------------------------
param(
    [ValidateSet('apk', 'aab', 'all')]
    [string]$Target = 'all',
    [switch]$Install
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root 'android'
$buildRoot = 'C:\dd-android-build\project'
$dist = Join-Path $android 'dist'

function Write-Step([string]$text) {
    Write-Host ""
    Write-Host "==> $text" -ForegroundColor Cyan
}

function Get-JavaHome {
    $candidates = @(
        $env:JAVA_HOME,
        'C:\Users\mabil\.jdks\jbr-17.0.14',
        'C:\Program Files\Android\Android Studio\jbr',
        (Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jbr')
    ) | Where-Object { $_ -and (Test-Path (Join-Path $_ 'bin\java.exe')) }

    foreach ($c in $candidates) {
        $ver = & (Join-Path $c 'bin\java.exe') -version 2>&1 | Out-String
        if ($ver -match 'version "(1[7-9]|2[0-9])') { return $c }
    }
    throw "JDK 17+ bulunamadı. JAVA_HOME ayarlayın veya Android Studio'yu kurun."
}

function Get-AndroidSdk {
    $candidates = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
    ) | Where-Object { $_ -and (Test-Path $_) }

    foreach ($sdk in $candidates) {
        if ((Test-Path (Join-Path $sdk 'platforms\android-36')) -and
            (Test-Path (Join-Path $sdk 'build-tools'))) { return $sdk }
    }
    throw "Android SDK (platform 36) bulunamadı. Android Studio SDK Manager'dan Android 16 / API 36 kurun."
}

$javaHome = Get-JavaHome
$sdk = Get-AndroidSdk
$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path = (Join-Path $javaHome 'bin') + ';' + (Join-Path $sdk 'platform-tools') + ';' + $env:Path

Write-Step "Java: $javaHome"
Write-Step "Android SDK: $sdk"

if (!(Test-Path (Join-Path $android 'keystore.properties'))) {
    throw "android\keystore.properties yok. Önce tools\android-keystore.ps1 çalıştırın."
}
if (!(Test-Path (Join-Path $android 'gradlew.bat'))) {
    throw "Gradle wrapper eksik: android\gradlew.bat"
}

# ------------------------------------------------------------------ kopya
if (Test-Path $buildRoot) { Remove-Item -Recurse -Force $buildRoot }
New-Item -ItemType Directory -Force $buildRoot | Out-Null
Copy-Item (Join-Path $android '*') $buildRoot -Recurse -Force
foreach ($junk in @('build', '.gradle', 'dist')) {
    $p = Join-Path $buildRoot $junk
    if (Test-Path $p) { Remove-Item -Recurse -Force $p }
}

$sdkProp = ($sdk -replace '\\', '/')
[System.IO.File]::WriteAllText(
    (Join-Path $buildRoot 'local.properties'),
    "sdk.dir=$sdkProp`n",
    (New-Object System.Text.UTF8Encoding($false))
)

# ------------------------------------------------------------------ derle
$gradlew = Join-Path $buildRoot 'gradlew.bat'
$tasks = @()
if ($Target -eq 'apk' -or $Target -eq 'all') { $tasks += ':app:assembleRelease' }
if ($Target -eq 'aab' -or $Target -eq 'all') { $tasks += ':app:bundleRelease' }

Write-Step "Gradle: $($tasks -join ' ')"
Push-Location $buildRoot
try {
    & $gradlew --no-daemon --console=plain @tasks
    if ($LASTEXITCODE -ne 0) { throw "Gradle derlemesi başarısız (kod $LASTEXITCODE)." }
} finally {
    Pop-Location
}

# ------------------------------------------------------------------ çıktı
$props = Get-Content (Join-Path $android 'gradle.properties') -Raw
$version = [regex]::Match($props, '(?m)^appVersionName=(.+)$').Groups[1].Value.Trim()
if (!$version) { $version = 'dev' }
$code = [regex]::Match($props, '(?m)^appVersionCode=(.+)$').Groups[1].Value.Trim()

New-Item -ItemType Directory -Force $dist | Out-Null
$apkOut = Join-Path $buildRoot 'app\build\outputs\apk\release\app-release.apk'
$aabOut = Join-Path $buildRoot 'app\build\outputs\bundle\release\app-release.aab'

Write-Step "Çıktılar"
if (Test-Path $apkOut) {
    $apkDest = Join-Path $dist "DeneyapEvKoruma-$version-release.apk"
    Copy-Item $apkOut $apkDest -Force
    $h = (Get-FileHash $apkDest -Algorithm SHA256).Hash
    Write-Host ("APK : {0}  ({1:N1} MB)" -f $apkDest, ((Get-Item $apkDest).Length / 1MB)) -ForegroundColor Green
    Write-Host ("      SHA-256: {0}" -f $h)
}
if (Test-Path $aabOut) {
    $aabDest = Join-Path $dist "DeneyapEvKoruma-$version-release.aab"
    Copy-Item $aabOut $aabDest -Force
    $h = (Get-FileHash $aabDest -Algorithm SHA256).Hash
    Write-Host ("AAB : {0}  ({1:N1} MB)" -f $aabDest, ((Get-Item $aabDest).Length / 1MB)) -ForegroundColor Green
    Write-Host ("      SHA-256: {0}" -f $h)
}

# ------------------------------------------------------------------ doğrula
$bt = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if ($bt -and (Test-Path (Join-Path $bt.FullName 'apksigner.bat'))) {
    if (Test-Path $apkOut) {
        Write-Step "İmza doğrulaması"
        & (Join-Path $bt.FullName 'apksigner.bat') verify --print-certs (Join-Path $dist "DeneyapEvKoruma-$version-release.apk")
    }
}

if ($Install) {
    if (!(Test-Path $apkOut)) { throw "-Install için APK üretilmedi; -Target apk veya all kullanın." }
    $adb = Join-Path $sdk 'platform-tools\adb.exe'
    Write-Step "Cihaza kuruluyor"
    & $adb install -r (Join-Path $dist "DeneyapEvKoruma-$version-release.apk")
    if ($LASTEXITCODE -ne 0) { throw "adb install başarısız (kod $LASTEXITCODE)." }
}

Write-Step "Bitti. Sürüm: $version (versionCode $code)"
Write-Host "Play Store'a yüklemek için .aab dosyasını kullanın." -ForegroundColor Yellow
Write-Host "Web'de yapılan değişiklikler için yeni APK gerekmez; uygulama canlı siteyi açar." -ForegroundColor Yellow
