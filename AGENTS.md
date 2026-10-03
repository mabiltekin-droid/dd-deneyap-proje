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

## Sürüm numarası — dört yerden birlikte

Bunlar birbirine bağlı, tek başına değiştirilmez:

1. `package.json` → `version`
2. `pwa/js/config.js` → `App.VERSION`
3. `pwa/sw.js` → `VERSION` (cache adı `deneyap-pwa-v<VERSION>` buradan geliyor)
4. `firmware/config.h` → `FW_VERSION`

Sürüm artırdığında **dördünü de** güncelle. Biri unutulursa PWA eski sürümü
göstermeye devam eder ("eski site açılıyor" hatasının klasik sebebi).
Panelde kullanıcıya gösterilen sürüm bu değerlerden gelir.

`npm run check` bu dördünün aynı olduğunu doğrular — commit öncesi çalıştır,
elle kontrol etmeye gerek kalmasın.

## Gizli bilgiler

- **`firmware/config.h` depoya girmez** (`.gitignore`'da). Şablonu
  `firmware/config.example.h`. İlk kurulumda `config.example.h`'i `config.h`
  olarak kopyala ve şifreleri kendi cihazına göre yaz.
- `AP_PASSWORD` ve `API_TOKEN` asla commit edilmez. Bir API anahtarı, şifre veya
  kişisel bilgi gerekiyorsa önce kullanıcıya sor.
- Depoyu her hâlükârda **private** tut.

## PWA kuralları

- **`file://` ile açılmaz.** Service Worker ve `fetch` güvenlik bağlamı ister.
  Yerel geliştirme için `npm run dev` kullan — sahte cihaz da sunar.
- **`pwa/` içine yeni bir dosya eklediysen `pwa/sw.js` içindeki `PRECACHE`
  listesine de ekle.** Eklenmezse dosya çevrimdışıyken veya ilk yüklemede
  bulunamaz. `npm run check` bunu unutursan hata olarak bildirir.
- Dosya düzenleme sırası: `sw.js` (`PRECACHE`) → `config.js` (`VERSION`) →
  `api.js` → `history.js` → `notify.js` → `app.js` → `settings.js`.
  Modüller sırayla yüklenir.
- Ağ trafiğinin tamamı `pwa/js/api.js` üzerinden geçer. Yeni bir uç nokta
  eklersen buraya ekle, `app.js` içinden doğrudan `fetch` atma.
- **SVG elementlerine `textContent` atama.** `<path>` için `setAttribute('d', …)`,
  `<g>` içine markup eklemek için `innerHTML` gerekir. `textContent` SVG'de
  markup üretmez, sessizce hiçbir şey çizmez. (Bu hataya düşüldü.)
- PWA dosyalarını cihaza yükledikten sonra tarayıcıda service worker'ı
  "Yenile" bildirimi üzerinden etkinleştir; eski cache'i unutma.

## Modüller

| Dosya | Sorumluluk |
|---|---|
| `pwa/js/config.js` | sürüm, varsayılanlar, ayar deposu, tema, toast, SW kaydı |
| `pwa/js/api.js` | tüm ağ trafiği: zaman aşımı, iptal, token, JSON hataları |
| `pwa/js/history.js` | sensör geçmişi (localStorage) + sparkline çizimi |
| `pwa/js/notify.js` | tehlike bildirimleri, izin yönetimi, 90 sn bekleme |
| `pwa/js/app.js` | ana panel denetleyicisi |
| `pwa/js/settings.js` | ayarlar sayfası denetleyicisi |

Geçmiş yalnızca tarayıcıda tutulur ve **son 30 dakika** ile sınırlıdır
(cihazda RAM yok). Bildirimler yalnızca panel açıkken çalışır; arka plan
izlemi yok.

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
- **Renk ve ölçü için `DESIGN.md`'yi değil, `pwa/css/style.css` başındaki
  değişkenleri kullan.** `DESIGN.md` "Dala" adlı ayrı bir markanın stil
  referansı; bu projenin gerçek token'ları orada değil:
  `--bg --surface --surface-2 --text --text-dim --primary --accent --warn
  --danger --border --radius --radius-sm`. Serbest renk/tanım uydurma.
  (DESIGN.md'nin saf siyah yüzey, çerçevesiz kart kuralı bu panelde
  uygulanmıyor; panelin açık/koyu teması ve kart çerçeveleri mevcut.)
- Küçük ve bağımsız değişiklikleri tek commit'te topla, commit'i ne yaptığını
  anlatacak şekilde yaz.
- Commit öncesi `npm run check` çalıştır.

## Araçlar (tools/)

| Dosya | Ne yapar |
|---|---|
| `tools/dev-server.js` | Sahte cihaz: `pwa/`'yı sunar, `/api/*` uçlarını simüle eder. `npm run dev` |
| `tools/check-js.js` | Commit öncesi denetim: sözdizimi, sürüm tutarlılığı, PRECACHE, HTML referansları. `npm run check` |
| `tools/make-icons.ps1` | PWA ikonlarını yeniden üretir. `npm run icons` |

Sahte cihaz gaz seviyesini 90 saniyelik bir döngüyle yükseltip eşikleri
geçer; böylece uyarı/tehlike banner'ı, rozetler, grafik ve otomatik müdahale
cihaz olmadan denenebilir. Eşikleri `firmware/config.h`'den okur, port doluysa
`--port` ile değiştirilir.

## Git akışı

- `main` her zaman çalışan halde olmalı.
- Yeni özellik: `git switch -c ozellik/ne-yapıyor`
- İşe başlamadan önce `git pull`, bitince `git push` ve **Pull Request**.
- Doğrudan `main`'e push etme. Sık çakışan dosyalar: `pwa/js/app.js`,
  `pwa/sw.js`, `pwa/css/style.css`, `DESIGN.md`.
- Çakışmayı çözerken `--ours`/`--theirs` ile körlemesine seçim yapma;
  `git diff` ile incele.

## OpenCode için ek notlar

- `opencode.jsonc` proje ayarlarını ve `/surum`, `/cihaz`, `/pwa`, `/PR`
  kısayollarını içerir.
- Oturumlar (session) paylaşılamaz. Birbirine bağlam aktarmak için **dosya yaz
  ve commit'le** — `AGENTS.md`, `DESIGN.md`, `CHANGELOG.md`.
- Paralel iş için git worktree kullan: her dal ayrı klasör, aynı depodan.