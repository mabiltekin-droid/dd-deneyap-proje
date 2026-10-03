# PWA ikonlarini uretir (GDI+). Tek seferlik: calistirip dosyayi silebilirsiniz.
# Kullanim: powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
param([string]$OutDir = (Join-Path $PSScriptRoot "..\pwa\icons"))

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$bg      = [System.Drawing.Color]::FromArgb(255, 18, 18, 18)
$stroke  = [System.Drawing.Color]::FromArgb(255, 91, 156, 255)
$dot     = [System.Drawing.Color]::FromArgb(255, 255, 184, 41)

function New-AppIcon {
    param(
        [string]$Path,
        [int]$Size,
        [double]$Fill,       # ucgen kutu dolulugu (0..1)
        [double]$DotRatio    # nokta capi (0..1)
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear($bg)

    $b  = [double]$Size * $Fill
    $ox = ([double]$Size - $b) / 2.0
    $oy = ([double]$Size - $b) / 2.0 + $b * 0.04   # ucgen biraz asagi otursun

    # ucgen: tepe -> sol alt -> sag alt  (CSS/SVG mark ile ayni geometri)
    $pts = @(
        (New-Object System.Drawing.PointF([single]($ox + $b * 0.5), [single]$oy)),
        (New-Object System.Drawing.PointF([single]$ox,              [single]($oy + $b))),
        (New-Object System.Drawing.PointF([single]($ox + $b),       [single]($oy + $b)))
    )

    $w   = [Math]::Max(2.0, [double]$Size * 0.042)
    $pen = New-Object System.Drawing.Pen($stroke, [single]$w)
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPolygon($pen, $pts)

    # amber vurgu noktasi
    $r    = [double]$Size * $DotRatio
    $dcx  = [double]$Size / 2.0
    $dcy  = $oy + $b * 0.66
    $br   = New-Object System.Drawing.SolidBrush($dot)
    $g.FillEllipse($br, [single]($dcx - $r), [single]($dcy - $r), [single]($r * 2), [single]($r * 2))

    $pen.Dispose(); $br.Dispose(); $g.Dispose()

    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host ("olusturuldu: {0} ({1}x{1})" -f $Path, $Size)
}

New-AppIcon -Path (Join-Path $OutDir "icon-192.png")     -Size 192 -Fill 0.60 -DotRatio 0.045
New-AppIcon -Path (Join-Path $OutDir "icon-512.png")     -Size 512 -Fill 0.60 -DotRatio 0.045
# maskable: guvenli alan %80 icinde kalmali, bu yuzden daha kucuk
New-AppIcon -Path (Join-Path $OutDir "maskable-512.png") -Size 512 -Fill 0.44 -DotRatio 0.033

Write-Host "bitti."