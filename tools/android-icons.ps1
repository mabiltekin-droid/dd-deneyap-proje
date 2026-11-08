# -----------------------------------------------------------------------------
#  Deneyap Ev Koruma - Android launcher / Play Store görselleri
#  PWA ikonlarından mipmap'leri ve Play Store görsellerini üretir.
#  Kullanım: npm run android:icons
# -----------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$pwaIcons = Join-Path $root 'pwa\icons'
$res = Join-Path $root 'android\app\src\main\res'
$play = Join-Path $root 'android\play'
$src = Join-Path $pwaIcons 'icon-512.png'
$maskable = Join-Path $pwaIcons 'maskable-512.png'

if (!(Test-Path $src)) { throw "Kaynak ikon bulunamadı: $src" }
if (!(Test-Path $maskable)) { $maskable = $src }
New-Item -ItemType Directory -Force $play | Out-Null

function Save-Resized([string]$source, [string]$dest, [int]$size) {
    $dir = Split-Path -Parent $dest
    New-Item -ItemType Directory -Force $dir | Out-Null
    $img = [System.Drawing.Image]::FromFile($source)
    try {
        $bmp = New-Object System.Drawing.Bitmap($size, $size)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.Clear([System.Drawing.Color]::Transparent)
            $g.DrawImage($img, 0, 0, $size, $size)
            $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $g.Dispose(); $bmp.Dispose() }
    } finally { $img.Dispose() }
}

function Save-Round([string]$source, [string]$dest, [int]$size) {
    $dir = Split-Path -Parent $dest
    New-Item -ItemType Directory -Force $dir | Out-Null
    $img = [System.Drawing.Image]::FromFile($source)
    try {
        $bmp = New-Object System.Drawing.Bitmap($size, $size)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.Clear([System.Drawing.Color]::Transparent)
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $path = New-Object System.Drawing.Drawing2D.GraphicsPath
            try {
                $path.AddEllipse(0, 0, $size, $size)
                $g.SetClip($path)
                $g.DrawImage($img, 0, 0, $size, $size)
            } finally { $path.Dispose() }
            $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $g.Dispose(); $bmp.Dispose() }
    } finally { $img.Dispose() }
}

# Eski Android sürümleri (API 24-25) ve launcher'lar için normal/round ikonlar
$legacy = @(
    @{ dir = 'mipmap-mdpi';    size = 48  },
    @{ dir = 'mipmap-hdpi';    size = 72  },
    @{ dir = 'mipmap-xhdpi';   size = 96  },
    @{ dir = 'mipmap-xxhdpi';  size = 144 },
    @{ dir = 'mipmap-xxxhdpi'; size = 192 }
)
foreach ($v in $legacy) {
    Save-Resized $src (Join-Path $res "$($v.dir)\ic_launcher.png") $v.size
    Save-Round   $src (Join-Path $res "$($v.dir)\ic_launcher_round.png") $v.size
}

# Adaptive icon foreground (API 26+); maskable ikon güvenli alanı korur.
$foreground = @(
    @{ dir = 'mipmap-mdpi';    size = 108 },
    @{ dir = 'mipmap-hdpi';    size = 162 },
    @{ dir = 'mipmap-xhdpi';   size = 216 },
    @{ dir = 'mipmap-xxhdpi';  size = 324 },
    @{ dir = 'mipmap-xxxhdpi'; size = 432 }
)
foreach ($v in $foreground) {
    Save-Resized $maskable (Join-Path $res "$($v.dir)\ic_launcher_foreground.png") $v.size
}

# Play Store: 512x512 uygulama ikonu
Copy-Item $src (Join-Path $play 'icon-512.png') -Force

# Play Store: 1024x500 feature graphic
$fg = New-Object System.Drawing.Bitmap(1024, 500)
$g = [System.Drawing.Graphics]::FromImage($fg)
try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $rect = New-Object System.Drawing.Rectangle(0, 0, 1024, 500)
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 250, 248, 242),
        [System.Drawing.Color]::FromArgb(255, 235, 242, 235),
        [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
    try { $g.FillRectangle($bg, $rect) } finally { $bg.Dispose() }

    $accent = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 185, 107, 73), 3)
    try { $g.DrawLine($accent, 80, 372, 944, 372) } finally { $accent.Dispose() }

    $icon = [System.Drawing.Image]::FromFile((Join-Path $play 'icon-512.png'))
    try {
        $g.DrawImage($icon, 80, 94, 310, 310)
    } finally { $icon.Dispose() }

    $font1 = New-Object System.Drawing.Font('Segoe UI', 58, [System.Drawing.FontStyle]::Bold)
    $font2 = New-Object System.Drawing.Font('Segoe UI', 40, [System.Drawing.FontStyle]::Bold)
    $font3 = New-Object System.Drawing.Font('Segoe UI', 22, [System.Drawing.FontStyle]::Regular)
    $forest = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 47, 91, 71))
    $muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 91, 106, 98))
    try {
        $g.DrawString('DD EV', $font1, $forest, 420, 120)
        $g.DrawString('KORUMA', $font2, $forest, 424, 216)
        $g.DrawString('ESP32 TABANLI AKILLI EV KORUMA SISTEMI', $font3, $muted, 426, 300)
    } finally {
        $font1.Dispose(); $font2.Dispose(); $font3.Dispose()
        $forest.Dispose(); $muted.Dispose()
    }
    $fg.Save((Join-Path $play 'feature-graphic-1024x500.png'), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $g.Dispose(); $fg.Dispose()
}

Write-Output "Android ikonları hazır: $res"
Write-Output "Play görselleri: $play"
