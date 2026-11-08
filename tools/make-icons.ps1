# -----------------------------------------------------------------------------
#  DD Ev Koruma - PWA ikonlarini uretir.
#  Kaynak: pwa/icons/logo-mark.svg
#  Kullanim: npm run icons
#
#  Not: Android mipmap'leri icin ayrica `npm run android:icons` calistirin.
# -----------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$icons = Join-Path $root 'pwa\icons'
$svg = Join-Path $icons 'logo-mark.svg'
if (!(Test-Path $svg)) { throw "Logo kaynagi bulunamadi: $svg" }

$chromeCandidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
)
$chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (!$chrome) { throw 'Chrome veya Edge bulunamadi. SVG rasterlestirme icin tarayici gerekli.' }

$tmp = Join-Path $env:TEMP ('dd-ev-koruma-icons-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null
$svgUri = ([System.Uri]$svg).AbsoluteUri

function Render-Html([string]$name, [int]$size, [int]$imageSize, [int]$offsetY) {
    $html = @"
<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:#f7f2e4}
body{display:grid;place-items:center}
img{width:${imageSize}px;height:${imageSize}px;display:block;transform:translateY(${offsetY}px)}
</style></head><body><img src="$svgUri" alt=""></body></html>
"@
    $htmlPath = Join-Path $tmp "$name.html"
    $pngPath = Join-Path $tmp "$name.png"
    Set-Content -Path $htmlPath -Value $html -Encoding UTF8
    $htmlUri = ([System.Uri]$htmlPath).AbsoluteUri
    $profile = Join-Path $tmp 'chrome-profile'
    $argLine = '--headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 ' +
        '--no-first-run --disable-extensions --virtual-time-budget=1500 ' +
        '--user-data-dir="' + $profile + '" --window-size=' + $size + ',' + $size +
        ' --screenshot="' + $pngPath + '" "' + $htmlUri + '"'
    $proc = Start-Process -FilePath $chrome -ArgumentList $argLine -Wait -PassThru `
        -NoNewWindow -RedirectStandardError (Join-Path $tmp "$name.err") `
        -RedirectStandardOutput (Join-Path $tmp "$name.out")
    if ($proc.ExitCode -ne 0 -or !(Test-Path $pngPath)) {
        throw "Ikon uretilemedi: $name (cikis kodu $($proc.ExitCode))"
    }
    return $pngPath
}

function Resize-Png([string]$source, [string]$dest, [int]$size) {
    $img = [System.Drawing.Image]::FromFile($source)
    try {
        $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $g.DrawImage($img, 0, 0, $size, $size)
            $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $g.Dispose(); $bmp.Dispose() }
    } finally { $img.Dispose() }
}

try {
    $icon512 = Render-Html 'icon-512' 512 600 8
    $maskable512 = Render-Html 'maskable-512' 512 520 10

    Copy-Item $icon512 (Join-Path $icons 'icon-512.png') -Force
    Copy-Item $maskable512 (Join-Path $icons 'maskable-512.png') -Force
    Resize-Png $icon512 (Join-Path $icons 'icon-192.png') 192

    Write-Output "PWA ikonlari hazir: $icons"
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
