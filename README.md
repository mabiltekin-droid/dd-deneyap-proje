# nambir — Deneyap Ev Güvenlik / Seracılık Cihazı

ESP32-WROOM-32 (Deneyap Kart v2) tabanlı cihaz. Firmware cihazda çalışır ve
kendi HTTP sunucusunu açar; PWA dosyalarını cihazdan servis eder. Telefonda
tarayıcıyla `http://192.168.4.1` adresinden panele ulaşılır.

```
firmware/   Arduino kodu — cihazda çalışır (main.ino + config.h)
pwa/        Panel — saf HTML/CSS/JS, build adımı yok, cihazın LittleFS'ine yüklenir
tools/      dev-server.js (sahte cihaz), check-js.js (denetleyici), make-icons.ps1
DESIGN.md   Tasarım sistemi referansı (renk, tipografi, spacing token'ları)
AGENTS.md   Çalışma kuralları — değişiklik yapmadan önce oku
```

## Geliştirme

Bağımlılık yok, `npm install` gerekmez. Node 18+ yeterli.

```bash
npm run dev      # sahte cihaz + panel  →  http://localhost:3000
npm run check    # commit öncesi denetim (sözdizimi, sürüm, PRECACHE)
npm run icons    # PWA ikonlarını yeniden üret
```

**`npm run dev`** cihaz olmadan panel geliştirmeyi sağlar: `pwa/` klasörünü
sunar ve `/api/status` ile `/api/control` uçlarını simüle eder. Gaz seviyesi
yavaşça yükselip eşikleri geçer, bu sayede uyarı/tehlike banner'ı, rozetler,
grafik ve otomatik müdahale gerçekten test edilir.

```bash
node tools/dev-server.js --port 5173   # port doluysa
```

**`npm run check`** şunları doğrular:

| Kontrol | Neden |
|---|---|
| Her `.js` dosyasının sözdizimi | Cihaza yüklenmeden önce hata yakalar |
| Sürümün dört yerde aynı olduğu | `package.json` = `config.js` = `sw.js` = `config.h` |
| `sw.js` PRECACHE listesi `pwa/` ile uyumlu | Yeni dosya eklemeyi unutmayı yakalar |
| HTML dosya referansları | Kırık yol kalmaz |

Port 3000 başka bir uygulamada doluysa `--port` ile başka port ver.

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

> Yeni bir dosya eklediysen `pwa/sw.js` içindeki `PRECACHE` listesine de ekle.
> `npm run check` bunu unutursan hata olarak bildirir.

Yükleme yapılmazsa cihaz API-only modda çalışır ve tarayıcıda bilgilendirme
sayfası gösterir.

PWA'yı yerelde geliştirmek için `npm run dev` (yukarıya bak) — ya da cihaz
olmadan sadece statik dosyaları görmek istersen `npx serve pwa`.

> PWA `file://` ile açılmaz (service worker gerekir). Yerelde `/api/status`
> çalışmaz; `npm run dev` onu da simüle eder.

## Sürüm numarası

Sürüm **dört dosyada birden** tutulur:

| Dosya | Değer |
|---|---|
| `package.json` | `version` |
| `pwa/js/config.js` | `App.VERSION` |
| `pwa/sw.js` | `VERSION` (cache adı bundan gelir) |
| `firmware/config.h` | `FW_VERSION` |

`npm run check` bu dördünün aynı olduğunu doğrular. Biri unutulursa PWA eski
sürümü gösterir.

## Panelde neler var

| Özellik | Nerede |
|---|---|
| Gaz / yağmur ölçümleri, sistem durumu | Sensörler kartları |
| **Son 30 dakika gaz grafiği** + istatistik | Geçmiş kartı (yalnızca bu tarayıcıda saklanır) |
| Fan, su motoru, buzzer, otomatik müdahale | Kontrol kartı |
| Pencere / panjur servoları | Kontrol kartı |
| **Gaz tehlikesi bildirimi** | Ayarlar → Bildirimler |
| Eşikler, bağlantı ayarları, önbellek bakımı | Ayarlar |

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