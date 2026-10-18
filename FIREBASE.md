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
