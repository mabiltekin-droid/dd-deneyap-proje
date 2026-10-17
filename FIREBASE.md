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
3. (İsteğe bağlı) E-posta doğrulama şablonlarını Türkçeleştir.

Bu iki adım tamamlanmadan panel oturum açamaz.

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

## 4) Bilinen sınırlamalar

- **İstemci tarafı rol ataması** bilinen bir yetki yükseltme (privilege
  escalation) açığıdır. Sertleştirme ancak **Cloud Functions** ile yapılır.
- `device_codes` düz metin parolayı yalnızca **admin** okuyabilir; normal
  kullanıcı ve anonim erişim kapalıdır.
- Cihaz bir hesaba bağlıysa, diğer hesaplar ve çıkış yapmış kullanıcılar için
  o cihaz **yok gibi** görünür (tüm panel gizlenir).
