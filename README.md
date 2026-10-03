# nambir — Deneyap Ev Güvenlik / Seracılık Cihazı

ESP32-WROOM-32 (Deneyap Kart v2) tabanlı cihaz. Firmware cihazda çalışır ve
kendi HTTP sunucusunu açar; PWA dosyalarını cihazdan servis eder. Telefonda
tarayıcıyla `http://192.168.4.1` adresinden panele ulaşılır.

```
firmware/   Arduino kodu — cihazda çalışır (main.ino + config.h)
pwa/        Panel — saf HTML/CSS/JS, build adımı yok, cihazın LittleFS'ine yüklenir
tools/      make-icons.ps1 — PWA ikonlarını üretir
DESIGN.md   Tasarım sistemi referansı (renk, tipografi, spacing token'ları)
AGENTS.md   Çalışma kuralları — değişiklik yapmadan önce oku
```

## Kurulum

### 1. Depoyu al

```bash
git clone https://github.com/mabiltekin-droid/dd-deneyap-proje.git
cd dd-deneyap-proje
```

### 2. `config.h` oluştur

`firmware/config.h` depoya **girmez** (içinde cihaz şifresi var). Şablondan kopyala:

```powershell
copy firmware\config.example.h firmware\config.h
```

Sonra `firmware/config.h` içinde kendi cihazına göre düzenle:

- `AP_SSID` / `AP_PASSWORD` — cihazın açacağı hotspot
- `API_TOKEN` — `/api/control` koruması için. Boş bırakırsan koruma kapalı olur
  (ve aynı değeri PWA → Ayarlar → Cihaz Token alanına yazmalısın)

### 3. Gerekli programlar

| Program | Neden |
|---|---|
| [Git](https://git-scm.com) | clone / push |
| [VS Code](https://code.visualstudio.com) | kod yazma |
| [Arduino IDE 2](https://www.arduino.cc/en/software) | firmware derleme ve cihaza yükleme |
| Node.js | `npx serve` ile PWA'yı yerelde çalıştırmak için |

### 4. Firmware'yi yükle

Arduino IDE'de:

- Kart: **ESP32 Dev Module**
- Aynı portu seç (ilk yüklemede kartın **BOOT** butonuna basılı tut)
- `firmware/main.ino` dosyasını aç, yükle
- Seri monitörü **115200** baud ile aç

## PWA'yı cihaza yükle

`pwa/` klasörünün tamamı LittleFS'e yüklenmeli: `index.html`, `settings.html`,
`css/`, `js/`, `manifest.json`, `icons/`.

Yükleme yapılmazsa cihaz API-only modda çalışır ve tarayıcıda bilgilendirme
sayfası gösterir.

PWA'yı yerelde geliştirmek için:

```bash
npx serve pwa      # http://localhost:3000
```

> PWA `file://` ile açılmaz (service worker gerekir). Yerelde `/api/status`
> çalışmaz, panel "Cihaza ulaşılamıyor" der — bu normal, gerçek test için
> dosyaları cihaza yükle.

## Sürüm numarası

Sürüm **üç dosyada birden** tutulur:

| Dosya | Değer |
|---|---|
| `pwa/js/config.js` | `App.VERSION` |
| `firmware/config.h` | `FW_VERSION` |
| `pwa/sw.js` | `VERSION` (cache adı bundan gelir) |

Biri unutulursa PWA eski sürümü gösterir. Üçünü de birlikte güncelle.

## Çalışma akışı

```bash
git pull                            # başlamadan önce
git switch -c ozellik/yeni-sayfa    # dal aç, işe başla
# ... kod yaz ...
git add . && git commit -m "panel: filtre özelliği"
git push -u origin ozellik/yeni-sayfa
```

Sonra GitHub'dan **Pull Request** aç. `main` doğrudan güncellenmez.

Ayrıntılı kurallar ve donanım tuzakları için [AGENTS.md](AGENTS.md)'ye bak.