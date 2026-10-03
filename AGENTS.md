# nambir — çalışma kuralları

Bu dosya depoda tutulur, böylece projede çalışan **herkes** (ve herkesin
kullandığı OpenCode) aynı kurallara uyar. Değişiklik yapacaksan branch aç.

## Proje nedir

ESP32-WROOM-32 (Deneyap Kart v2) tabanlı ev güvenlik / seracılık cihazı.
İki parçadan oluşur ve **ikisi birlikte** çalışır:

| Klasör | Ne | Nerede çalışır |
|---|---|---|
| `firmware/` | Arduino kodu (`main.ino` + `config.h`) | Cihazda |
| `pwa/` | Panel (saf HTML/CSS/JS, build yok) | Cihazın LittleFS'i, telefonda görünür |

Firmware kendi HTTP sunucusunu çalıştırır, PWA dosyalarını cihazdan servis
eder ve sensör verisini JSON döner. Yani **PWA geliştirmek için ayrı bir backend
yoktur.** Build adımı, paket yöneticisi ve framework de yoktur.

## Donanım kuralları

- **Pin değişikliği sadece `firmware/config.h` içinde yapılır**, `main.ino`'ya dokunulmaz.
- **GPIO0, GPIO2, GPIO12 strapping pinidir.** Açılış anında LOW olmak zorundadır.
  Röle/fan/buzzer gibi çıkışları buraya bağlarsan cihaz boot loop'a düşer ve hiç açılmaz.
  Güvenli çıkışlar: 13, 25, 26, 27, 33.
- Analog girişler **mutlaka ADC1** kanalında olmalı (GPIO32–39). Wi-Fi açıkken ADC2 kullanılamaz.
  Yeni sensör eklersen buraya bak.
- A0/A1 gibi eski etiketler yerine GPIO numarası tercih edilir; `config.h` içindeki
  "eski (riskli) eşleşme" bloğu referans olarak duruyor.

## Sürüm numarası — üç yerden birlikte

Bunlar birbirine bağlı, tek başına değiştirilmez:

1. `pwa/js/config.js` → `App.VERSION`
2. `firmware/config.h` → `FW_VERSION`
3. `pwa/sw.js` → `VERSION` (cache adı `deneyap-pwa-v<VERSION>` buradan geliyor)

Sürüm artırdığında **üçünü de** güncelle. Biri unutulursa PWA eski sürümü
göstermeye devam eder ("eski site açılıyor" hatasının klasik sebebi).
Panelde kullanıcıya gösterilen sürüm bu değerlerden gelir.

## Gizli bilgiler

- **`firmware/config.h` depoya girmez** (`.gitignore`'da). Şablonu
  `firmware/config.example.h`. İlk kurulumda `config.example.h`'i `config.h`
  olarak kopyala ve şifreleri kendi cihazına göre yaz.
- `AP_PASSWORD` ve `API_TOKEN` asla commit edilmez. Bir API anahtarı, şifre veya
  kişisel bilgi gerekiyorsa önce kullanıcıya sor.
- Depoyu her hâlükârda **private** tut.

## PWA kuralları

- **`file://` ile açılmaz.** Service Worker ve `fetch` güvenlik bağlamı ister.
  Test için: `npx serve pwa` → `http://localhost:3000`
- Yerelde cihaz API'si yoktur (`/api/status` çalışmaz), panel "erişilemiyor"
  der. Bu normal. Gerçek test için `pwa/` klasörünü olduğu gibi cihaza yükle.
- **`pwa/` içine yeni bir dosya eklediysen `pwa/sw.js` içindeki `PRECACHE`
  listesine de ekle.** Eklenmezse dosya çevrimdışıyken veya ilk yüklemede bulunamaz.
- Dosya düzenleme sırası: `sw.js` (`PRECACHE`) → `config.js` (`VERSION`) →
  `api.js` → `app.js` → `settings.js`. Modüller sırayla yüklenir.
- Ağ trafiğinin tamamı `pwa/js/api.js` üzerinden geçer. Yeni bir uç nokta
  eklersen buraya ekle, `app.js` içinden doğrudan `fetch` atma.
- PWA dosyalarını cihaza yükledikten sonra tarayıcıda service worker'ı
  "Yenile" bildirimi üzerinden etkinleştir; eski cache'i unutma.

## API sözleşmesi

Firmware ve PWA ayrı ayrı güncellenebilir ama alan adları eşleşmek zorunda:

| Uç | Metot | Kullanım |
|---|---|---|
| `/api/status` | GET | sensör okumaları, rssi, heap, uptime, `fw` sürümü |
| `/api/control` | POST | `{ device, action, value }` — röle/servo komutları |
| `/api/control` | GET | link ile tetikleme (aynı parametreler query string'de) |

`/api/control` `X-Auth-Token` başlığı veya `token` query parametresiyle korunur
(`API_TOKEN` boşsa koruma kapalı). Firmware'de bir JSON alanı ekliyorsan aynı
anda `api.js` ve `app.js` tarafını da güncelle.

## Stil

- **Yorumlar ve commit mesajları Türkçe.** Mevcut kod böyle, tutarlılık şart.
- Mevcut yapıyı koru: IIFE içinde `window.App` namespace'i, `App.xxx` fonksiyonları.
  Framework, bundler veya `import` ekleme — cihazda build yok, dosyalar olduğu
  gibi servis edilir.
- Tasarım değişikliği yapacaksan önce `DESIGN.md`'yi oku; renk ve tipografi
  token'ları orada tanımlı. Serbest değerler uydurma.
- Küçük ve bağımsız değişiklikleri tek commit'te topla, commit'i ne yaptığını
  anlatacak şekilde yaz.

## Git akışı

- `main` her zaman çalışan halde olmalı.
- Yeni özellik: `git switch -c ozellik/ne-yapıyor`
- İşe başlamadan önce `git pull`, bitince `git push` ve **Pull Request**.
- Doğrudan `main`'e push etme. Sık çakışan dosyalar: `pwa/js/app.js`,
  `pwa/sw.js`, `pwa/css/style.css`, `DESIGN.md`.
- Çakışmayı çözerken `--ours`/`--theirs` ile körlemesine seçim yapma;
  `git diff` ile incele.

## OpenCode için ek notlar

- `opencode.jsonc` proje ayarlarını ve `/surum` gibi kısayolları içerir.
- Oturumlar (session) paylaşılamaz. Birbirine bağlam aktarmak için **dosya yaz
  ve commit'le** — `AGENTS.md`, `DESIGN.md`, `CHANGELOG.md`.
- Paralel iş için git worktree kullan: her dal ayrı klasör, aynı depodan.