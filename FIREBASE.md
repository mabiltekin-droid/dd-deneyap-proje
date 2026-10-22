# Firebase Kurulumu ve Yayınlama

Bu proje **Firebase Auth + Cloud Firestore** kullanır. Güvenlik kuralları
(`firestore.rules`) ve indeksler (`firestore.indexes.json`) depoda sürümlenir;
ancak canlı projeye ayrıca **yayınlanmaları** gerekir.

- Proje kimliği: **`ddproje-9f594`** (`.firebaserc` içinde sabitlidir)
- Yapılandırma: `firebase.json` (yalnızca Firestore; barındırma Vercel'de)

---

## 0) Console'da bir kez yapılacaklar

1. **Firestore Database** oluşturulmuş olmalı (Native mode).
2. **Authentication → Sign-in method → Email/Password** etkin olmalı.
3. **Sosyal girişler** (Google / GitHub / Apple) isteğe bağlıdır — aşağıya bakın.
4. (İsteğe bağlı) E-posta doğrulama şablonlarını Türkçeleştir.

Bu adımlar tamamlanmadan panel oturum açamaz.

### 0.1) Sosyal girişler (Google / GitHub / Apple)

Üçü de aynı akışla çalışır: açılır pencere (popup); tarayıcı engellerse tam sayfa
yönlendirme. Kullanıcı tarafında kod hazırdır — yalnızca Console'da sağlayıcıyı açın.

**Ortak adım (hepsi için geçerli):**

**Authentication → Settings → Authorized domains** listesine üretim alan adını
ekleyin (ör. `ddproje.vercel.app`). `localhost` ve `ddproje-9f594.firebaseapp.com`
zaten varsayılan olarak yetkilidir. Listede olmayan bir alan adından giriş
`auth/unauthorized-domain` verir.

#### Google
1. **Authentication → Sign-in method → Google → Enable**.
2. **Proje destek e-postası** (support email) seçin. İlk kez açarken Google OAuth
   onay ekranı otomatik oluşturulur.

#### GitHub
GitHub, kendi OAuth uygulamanızı ister:
1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
   - **Application name:** `Deneyap Ev Koruma`
   - **Homepage URL:** `https://ddproje.vercel.app`
   - **Authorization callback URL:** `https://ddproje-9f594.firebaseapp.com/__/auth/handler`
2. **Generate a new client secret** → Client ID ve Secret'ı kopyalayın.
3. Firebase Console → **Authentication → Sign-in method → GitHub → Enable**;
   kopyaladığınız **Client ID** ve **Client Secret**'ı girin, **Save**.

> GitHub hesabında e-posta **gizli** ise giriş hata verir. Çözüm: GitHub →
> Settings → Emails → e-postayı doğrulayıp **"Keep my email addresses private"**
> seçeneğini kapatmak. (Panelde bu durumda anlaşılır bir uyarı gösterilir.)

#### Apple
Apple, ücretli **Apple Developer Program** üyeliği ve bir Service ID ister:
1. Apple Developer → **Certificates, Identifiers & Profiles → Identifiers →
   Services IDs → +** ile bir Service ID oluşturun (ör. `com.ornek.deneyap.web`).
   - **Return URLs:** `https://ddproje-9f594.firebaseapp.com/__/auth/handler`
2. **Keys → +** ile bir **Sign in with Apple** anahtarı oluşturun; `.p8`
   dosyasını indirin (Key ID ve Team ID'yi not edin).
3. Firebase Console → **Authentication → Sign-in method → Apple → Enable**;
   **Service ID**, **Team ID**, **Key ID** ve `.p8` dosyasını girin, **Save**.

> Apple e-postayı yalnızca **ilk** yetkilendirmede paylaşır ve kullanıcı
> "Hide My Email" seçtiyse `@privaterelay.appleid.com` adresi gelir — panel bunu
> normal e-posta olarak kabul eder.

#### Ortak notlar
> • Sosyal girişle **ilk giren** hesap (profil hiç yoksa) **otomatik ADMIN** olur.
> • `?invite=KOD` bağlantısıyla gelip sosyal girişle katılan kullanıcı davetin rolünü alır.
>   **`admin` rolü yalnızca `role: admin` bir davetle verilebilir** (bkz. bölüm 4).
> • Sosyal hesapların e-postası doğrulanmış kabul edilir; ek doğrulama adımı yoktur.
> • Aynı e-posta şifre ile de kayıtlıysa `auth/account-exists-with-different-credential`
>   verir → önce e-posta + şifre ile giriş yapılmalıdır.
> • Sağlayıcı kapalıysa buton `auth/operation-not-allowed` için Türkçe uyarı gösterir.

---

## 1) Yol A — CLI ile (önerilen)

Firebase CLI'ı kurmaya gerek yok; `npx` gerekirse indirir.

```powershell
# Yalnızca ilk seferde giriş yap
npx --yes firebase-tools login

# Kuralları yayınla
npm run deploy:rules
# İndeksleri yayınla
npm run deploy:indexes
# İkisini birden
npm run deploy:firestore
```

Yayınlanmış indeksleri listelemek için:

```powershell
npm run firestore:list
```

> Not: `firebase-tools` global kuruluysa `npx --yes firebase-tools` yerine
> doğrudan `firebase` yazabilirsin.

---

## 2) Yol B — Console ile (elle)

### 2.1) Güvenlik kuralları

Firestore Database → **Rules** → `firestore.rules` dosyasının **tamamını**
yapıştır → **Publish**.

Kuralların kapsadığı koleksiyonlar:

| Koleksiyon | Amaç |
| --- | --- |
| `profiles` | Kullanıcı profilleri / roller (doc ID = uid) |
| `device_bindings` | Cihaz mülkiyeti (doc ID = device_id) |
| `device_codes` | Cihaz aktivasyon kodları (yalnızca admin) |
| `device_unlocks` | Kod girişi doğrulaması (kimse okuyamaz) |
| `login_logs` | Giriş/çıkış kayıtları |
| `alarm_events` | Olay günlüğü / alarm geçmişi |
| `invites` | Davet kodları |
| `audit_logs` | Yönetici işlem kayıtları |
| `config/bootstrap` | İlk-kurulum işareti (yalnızca bir kez oluşturulur) |

### 2.2) Bileşik (composite) indeksler

Firestore Database → **Indexes** → **Create index** (Composite).
Gereken indeksler:

| Koleksiyon | Alan 1 | Alan 2 |
| --- | --- | --- |
| `login_logs` | `userId` — Ascending | `timestamp` — Descending |
| `alarm_events` | `owner_id` — Ascending | `at` — Descending |
| `alarm_events` | `dev` — Ascending | `at` — Descending |
| `device_bindings` | `owner_id` — Ascending | `bound_at` — Descending |

> **Tek alanlı indeksler otomatiktir.** `created_at`, `bound_at`, `at`,
> `created_at_ms` gibi alanlar için elle indeks eklemene gerek yoktur;
> Firestore bunları kendiliğinden oluşturur.

---

## 3) Doğrulama

1. Paneli aç, e-postası **doğrulanmış** bir hesapla oturum aç.
2. **İlk açılan hesap otomatik ADMIN** olur.
3. Olay Günlüğü sekmeleri hatasız açılıyorsa `alarm_events` kuralı ve
   indeksleri doğru demektir.
4. Ayarlar → Telegram / Eşikler gibi alanlar kaydedilebiliyorsa `profiles`
   yazma kuralı doğrudur.

---

## 4) Rol modeli (yetki güvenliği)

`admin` rolü **sunucu tarafında** korunur (`firestore.rules`). Bir kullanıcı
kendi profilini `admin` yaparak yetki yükseltemez:

| İşlem | Kural |
| --- | --- |
| Kayıt (create) — rol `user` | Serbest (her kullanıcı kendisi için) |
| Kayıt (create) — rol `admin` | Yalnızca **geçerli, kullanılmamış, `role: admin`** bir davet kodu ile (`profiles/{uid}.invite_code`) **veya** ilk-kurulum işaretiyle |
| Güncelleme (update) — rol değişmeden | Kendi profilini güncelleyebilir (ad, avatar, tercihler) |
| Güncelleme (update) — `role`/`id` değiştirme | **Yalnızca admin** |
| Admin başka kullanıcı oluşturma | Admin panelinden serbest (`isAdmin()`) |

**İlk kurulum:** Firestore kural motoru koleksiyon *sayamadığı* için "ilk
kullanıcı admin olur" kuralı `config/bootstrap` işaretiyle uygulanır. Bu işaret
yalnızca **bir kez** oluşturulabilir ve yazan kişiye kilitlenir; ilk kayıt olan
kullanıcı bu işareti alır ve admin olur, sonraki kullanıcılar alamaz.

> **Yeni (boş) bir projeye sıfırdan başlarken** admin'i Console'dan da
> atayabilirsiniz: Firestore'da `profiles/{uid}` dokümanını açıp `role` alanını
> `admin` yapın (Console yazmaları kurallara takılmaz).

---

## 5) Bilinen sınırlamalar

- `device_codes` düz metin parolayı yalnızca **admin** okuyabilir; normal
  kullanıcı ve anonim erişim kapalıdır.
- Cihaz bir hesaba bağlıysa, diğer hesaplar ve çıkış yapmış kullanıcılar için
  o cihaz **yok gibi** görünür (tüm panel gizlenir).
- Sistem bildirimleri (Notification API + Service Worker) yalnızca **HTTPS**
  veya `localhost` üzerinde çalışır. Cihazın kendi ağ adresinde (`http://192.168.4.1`)
  tarayıcı bildirim/Service Worker izni vermez — bu normaldir, Vercel adresi kullanın.

---

## 6) Arka plan bildirimi (Web Push / Vercel gönderici)

İki katman vardır:

| Katman | Panel açıkken | Panel kapalıyken | Nerede yönetilir |
| --- | --- | --- | --- |
| **Yerel bildirim** | ✅ | ❌ | Tarayıcı (`pwa/js/notify.js`) |
| **Web Push (uzak)** | ✅ | ✅ | Vercel gönderici + `push_subs` |
| **Telegram** | ✅ | ✅ | Cihaz (doğrudan `api.telegram.org`) |

Yerel bildirim kurulum gerektirmez; Ayarlar → Bildirimler → **İzin Ver** yeterlidir.
Aşağısı yalnızca **panel kapalıyken de bildirim** istiyorsanız gereklidir.

### 6.1) VAPID anahtarları (bir kez)

```powershell
npm run vapid        # node tools/gen-vapid.js
```

Bu, depoya **girmeyen** `.vapid.json` dosyasını üretir ve ekrana şunları yazar:
`publicKey` (panele gider), `privateKey` ve `triggerSecret` (Vercel'e gider).

`publicKey` değerini `pwa/js/config.js` içindeki `App.VAPID_PUBLIC_KEY` alanına
kopyalayın (depoda zaten bir anahtar kayıtlıdır; isterseniz kendi anahtarınızı
üretip değiştirin — anahtar değişirse mevcut abonelikler geçersiz olur).

### 6.2) Servis hesabı (abonelikleri okumak için)

Firebase Console → Proje Ayarları → **Servis hesapları** → *Yeni özel anahtar
oluştur* → JSON dosyası. Gönderici bu anahtarla `push_subs` koleksiyonunu okur
(Admin SDK güvenlik kurallarını atlar; bu yüzden anahtar **gizlidir**).

### 6.3) Vercel ortam değişkenleri

Vercel → Proje → Settings → Environment Variables:

| Ad | Değer |
| --- | --- |
| `VAPID_PUBLIC_KEY` | `.vapid.json` → `publicKey` |
| `VAPID_PRIVATE_KEY` | `.vapid.json` → `privateKey` |
| `VAPID_SUBJECT` | `mailto:size@ornek.com` |
| `PUSH_TRIGGER_SECRET` | `.vapid.json` → `triggerSecret` |
| `FIREBASE_SERVICE_ACCOUNT` | Servis hesabı JSON'u **tek satır** olarak |

> JSON'u tek satıra indirmek (PowerShell):
> ```powershell
> (Get-Content key.json -Raw).Replace("`r","").Replace("`n","") | Set-Clipboard
> ```

Deploy: `git push` (Vercel otomatik yayınlar).

### 6.4) Doğrulama

```powershell
curl.exe -s "https://<proje>.vercel.app/api/push"
# → {"ok":true,"configured":{"vapid":true,"firestore":true},"ready":true}

curl.exe -s -X POST "https://<proje>.vercel.app/api/push" `
  -H "content-type: application/json" `
  -H "x-dd-secret: <PUSH_TRIGGER_SECRET>" `
  -d "{\"kind\":\"test\"}"
# → {"ok":true,"kind":"test","targeted":1,"sent":1,"removed":0,"failed":0}
```

`targeted:0` ise panelde henüz abonelik yok demektir: Ayarlar → Bildirimler →
**Arka Plan Bildirimini Aç**.

### 6.5) Firmware

`firmware-mqtt/DeneyapEvKoruma/config.h`:

```c
#define PUSH_URL    "https://<proje>.vercel.app/api/push"
#define PUSH_SECRET "<PUSH_TRIGGER_SECRET>"
```

Boş bırakılırsa özellik kapalıdır (derleme boyutuna hiç yansımaz). Doldurulunca
cihaz; alev, gaz tehlikesi, su baskını ve sarsıntı anında göndericiye haber
verir (aynı türden 30 sn'de bir). Telegram'dan bağımsızdır.

---

## 7) Oturum güvenliği (adım yükseltme / step-up)

**Amaç:** çalınmış veya uzun süredir açık bırakılmış bir oturumla kritik işlem
yapılmasını engellemek. Kural **sunucu tarafında** (`firestore.rules`) zorlanır;
istemci yalnızca aynı denetimi önceden gösterip kullanıcıyı yönlendirir.

### 7.1) Kural nasıl çalışır?

Firebase ID token'ı `auth_time` adlı bir damga taşır: kullanıcının **en son
kimlik doğruladığı** an. `firestore.rules` bu değeri `request.time` ile
karşılaştırır:

| Kademe | Süre | Kapsam |
| --- | --- | --- |
| `freshSignIn()` | **15 dk** | Rol değiştirme, kullanıcı oluşturma, davet oluşturma/iptali, aktivasyon kodu yazma/silme, cihaz bağlantı onayı/reddi, zorla serbest bırakma, yeniden atama, ilk-kurulum işareti |
| `recentSignIn()` | **60 dk** | Cihaz bağlama, bağlantı kesme talebi/geri alma, kod doğrulama kaydı |

Ayrıca cihaz bağlarken e-posta **doğrulanmış** olmalıdır
(`request.auth.token.email_verified == true`).

`auth_time` yalnızca **yeniden kimlik doğrulamayla** tazelenir; token yenilemek
(veya sayfayı yenilemek) yetmez — bu yüzden koruma gerçektir.

> Günlük işlemler (ad/avatar güncelleme, ayar kaydetme, telemetri, geçmiş)
> **etkilenmez**; kilitlenme yaşanmaz.

### 7.2) Panelde ne olur?

Ayarlar → Profilim → **Oturum Güvenliği**:

- **Durum rozeti:** `TAZE` (15 dk içinde) / `KISMEN` (60 dk içinde) / `ESKİ`.
- Kritik bir işlem denenip süre geçmişse panel **kendiliğinden** şifre
  penceresini açar ("Tekrar Doğrula"); şifre girilince işlem tekrar denenebilir.
- **Hareketsizlikte otomatik çıkış:** varsayılan **30 dk** (15/30/60/120 veya
  kapalı). Yalnızca kullanıcı etkileşimi sayılır; telemetri akışı oturumu
  canlı tutmaz.
- **Son Giriş Etkinlikleri** tablosu: giriş/çıkış/**tekrar doğrulama**
  (`step_up`) kayıtları; tarayıcı ve işletim sistemi ile birlikte.

### 7.3) Şifre politikası

Kayıt, yönetici kullanıcı oluşturma ve şifre değiştirme aynı kuralı kullanır:
**en az 8 karakter, en az bir harf ve bir rakam**, tahmin edilebilir
şifreler (`1234…`, `password`, `deneyap`…) reddedilir
(`pwa/js/config.js` → `App.passwordIssue`).

### 7.4) Kuralları sınamak (isteğe bağlı, önerilir)

```powershell
npm run test:rules
```

Bu, **Firestore emülatörünü** başlatır (kurallar başlarken derlenir — sözdizimi
denetimi) ve 29 senaryoyu gerçek kural motorunda çalıştırır: taze/bayat oturumla
kritik yazmalar, doğrulanmamış e-posta, kodsuz bağlama, rol yükseltme denemesi…

> Emülatör **Java 21+** ister (firebase-tools 15.x). Sarmalayıcı uygun Java'yı
> kendisi arar (JAVA_HOME → PATH → yaygın kurulumlar). Android Studio'nun
> Java'sı yeterlidir.

### 7.5) Bilinçli sınırlama: gerçek 2FA

Authenticator (TOTP) veya SMS ile **ikinci faktör sunucuda doğrulanmalıdır**;
bu da ya Cloud Functions ya da Identity Platform/Blaze planı gerektirir. Bu
proje **Cloud Functions kullanmaz**; Firestore kuralları da HMAC/TOTP
hesaplayamaz. Tarayıcıda yapılan bir TOTP kontrolü atlatılabilir (saldırgan
SDK'yı doğrudan kullanır) ve gerçek bir güvenlik sınırı oluşturmaz. Bu yüzden
burada **adım yükseltme + oturum sertleştirme** uygulanmıştır. Gerçek MFA
istenirse: Blaze + Identity Platform açılıp istemciye `multiFactor` akışı
eklenmelidir (sunucu tarafı yapılandırması zorunludur).

## 8) App Check (isteğe bağlı, önerilir)

Tarayıcıya gömülen Firebase yapılandırması (`apiKey`, `projectId`) herkese
açıktır. App Check olmadan biri kendi betiğini yazıp **panel dışından**
Firestore'a istek atabilir: kurallar yazmayı engeller ama okuma denemeleri, kota
tüketimi ve aktivasyon kodu deneme yüzeyi açık kalır. App Check her isteğe
reCAPTCHA v3 kanıtı ekler; konsolda **Enforce** açıldığında kanıtsız istek
reddedilir.

Kod tarafı hazır (`pwa/js/firebase.js`): `App.APP_CHECK_KEY` **boşken hiçbir şey
değişmez**. Doldurulunca App Check otomatik başlar.

1. Firebase Console → **App Check** → uygulamayı seç → **reCAPTCHA v3**.
2. Site anahtarı oluştur; **alan adlarına** `ddproje.vercel.app` ve `127.0.0.1`
   (yerel test) ekle.
3. `pwa/js/config.js`:
   ```js
   App.APP_CHECK_KEY = '6L...';   // reCAPTCHA v3 site anahtarı
   ```
4. Yerelde ilk açılışta konsola bir **hata ayıklama jetonu** yazılır
   (`FIREBASE_APPCHECK_DEBUG_TOKEN`). App Check → Uygulamalar → **Hata ayıklama
   jetonları** bölümüne ekle; yoksa localhost istekleri reddedilir.
5. Yeniden deploy et, birkaç gün **İzleme (monitor)** modunda çalıştır. İstekler
   `doğrulanmış` görünüyorsa Firestore için **Enforce**'u aç. (Auth için App
   Check gerekmez.)

> Enforce'u açmadan önce Vercel alan adının reCAPTCHA anahtarında kayıtlı
> olduğundan emin ol; aksi hâlde panel `permission-denied` verir.

## 9) Haftalık özet bildirimi (Vercel Cron)

`api/digest.js` her pazartesi 09:00 (TRT) son 7 günün `alarm_events`
kayıtlarını toplar ve tek bir Web Push gönderir:
`Bu hafta 12 olay · 3 gaz · 2 alev · En yoğun: Salı 21:00`.

`vercel.json` içinde zamanlama hazırdır:
`"crons": [{ "path": "/api/digest", "schedule": "0 6 * * 1" }]` (06:00 UTC = 09:00 TRT).

Tek ek adım: Vercel → Settings → Environment Variables → **`CRON_SECRET`**
(rastgele uzun bir dize). Vercel, cron isteğine bu değeri
`Authorization: Bearer ...` olarak kendisi ekler; yoksa endpoint 401 verir.

Elle deneme:

```powershell
# Göndermeden önizleme (kaç olay, hangi türler)
curl.exe -H "x-dd-secret: <PUSH_TRIGGER_SECRET>" "https://ddproje.vercel.app/api/digest?dry=1"
# Gerçekten gönder
curl.exe -H "x-dd-secret: <PUSH_TRIGGER_SECRET>" "https://ddproje.vercel.app/api/digest"
```

> Vercel Hobby planında cron günde birden sık çalışamaz; haftalık ifade uygundur.

## 10) Kablosuz firmware güncellemesi (OTA)

İki firmware de `ArduinoOTA` içerir: kart yerinde kalsa da USB kablo olmadan
güncellenebilir. Şifre `config.h` → `OTA_PASSWORD` (boşsa OTA kapalı kalır).

```powershell
npm run fw:ota -- 192.168.1.50        # MQTT firmware (kartın Wi-Fi IP'si)
npm run fw:ota:legacy -- 192.168.4.1  # HTTP/AP firmware (kartın AP adresi)
```

Komut önce derler, sonra ESP32 çekirdeğindeki `espota.exe` ile kablosuz yükler
(`tools/build-firmware.ps1 -UploadNetwork`). Arduino IDE'den de
**Araçlar → Port → ağ portu** (`deneyap-ev.local`) seçilerek yüklenebilir.

- Kart en az bir kez **OTA destekli** firmware ile USB'den yüklenmiş olmalı.
- Aynı ağda olmak gerekir; `OTA_PASSWORD` varsayılanını değiştirin.
- Yükleme bitince cihaz kendini yeniden başlatır.

## 11) Panel yenilikleri (2.19.0)

- **Gün doğumu / gün batımı zamanlaması** — Ayarlar → Çalışma Modları: konum
  (enlem/boylam veya “Konumumu Kullan”) girilince kural başlangıç/bitişi
  `Saat / Doğuş / Batış ± dakika` olarak seçilebilir. Konum yoksa yazılı saat
  kullanılır (kural sessizce ölü kalmaz). Hesap NOAA formülü, ~±2 dk hata;
  `npm run test:sun` ile sınanır.
- **Gaz sensörü kalibrasyon sihirbazı** — Ayarlar → Donanım Eşikleri: 60 sn
  temiz hava ölçümü, medyan taban ve önerilen uyarı/tehlike eşikleri. Onay
  verilmeden hiçbir şey kaydedilmez.
- **Güvenlik başlıkları** — `vercel.json`: CSP, HSTS, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`. CSP'yi `'unsafe-inline'` olmadan
  uygulayabilmek için satır içi tema betiği `pwa/js/theme-boot.js` dosyasına
  taşındı; geliştirme sunucusu (`npm run dev`) aynı başlıkları uygular, böylece
  CSP yayına çıkmadan test edilir.
