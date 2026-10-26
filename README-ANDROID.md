# Android Uygulaması (APK / AAB)

Deneyap Ev Koruma'nın Android paketi. Uygulama, canlı PWA'yı **tam ekran WebView**
içinde açar; adres çubuğu, tarayıcı düğmeleri veya Chrome bağımlılığı yoktur. Chrome
yalnızca kullanıcı isterse **“Chrome'da aç”** menüsünden devreye girer (Google ile giriş
için yedek yol). Böylece uygulama, Chrome bulunmayan veya Chrome'u kısıtlayan
telefonlarda da güvenilir biçimde açılır.

Web tarafında yapılan değişiklikler **yeni APK üretmeden** uygulamaya yansır; APK yalnızca
Android tarafı (ikon, isim, paket, izinler, sürüm, başlangıç adresi, yerel kabuk kodu)
değişince yeniden üretilir.

- **Paket adı:** `com.mabiltekin.deneyapevkoruma`
- **Uygulama adı:** Deneyap Ev Koruma
- **Web adresi:** https://ddproje.vercel.app/
- **Sürüm:** 2.23.0 — `versionCode 4`
- **minSdk:** 24 (Android 7.0+) · **targetSdk / compileSdk:** 36 (Android 16)
- **Mimari:** Tek, evrensel APK. Telefon/tablet için ayrı APK gerekmez; PWA responsive'dir.

## Hazır çıktılar

Derleme sonrası:

| Dosya | Kullanım |
|---|---|
| `android/dist/DeneyapEvKoruma-2.23.0-release.apk` | Telefona doğrudan kurulum / test |
| `android/dist/DeneyapEvKoruma-2.23.0-release.aab` | **Google Play'e yükleme** |
| `android/play/icon-512.png` | Play Store uygulama ikonu |
| `android/play/feature-graphic-1024x500.png` | Play Store öne çıkan görsel |
| `android/play/screenshots/` | 2.22.0 mobil kabuk telefon ekran görüntüleri (1080×1920) |

Bu derlemenin SHA-256 özetleri:

```
APK: 9575D10CD9C3A000B1AEC02E70D734EDAC1FC921CE1D6E165889460DCAFAE2DD
AAB: 4C83ACBF518DD87BEECD0F641F16D083CB94BC4A8834123C858EB760A871E693
```

> Yeniden derlemede bu özetler değişir. Play Store'a her yüklemede `appVersionCode`
> değerini artırın.

## Nasıl açılıyor?

1. Uygulama açılır ve siteyi doğrudan **dahili WebView** içinde yükler. Adres çubuğu,
   Chrome sekmesi veya tarayıcı arayüzü yoktur.
2. Sağ üstteki **⋮ yerel menü** ile sayfa yenilenir, Chrome'da açılır, bağlantı paylaşılır
   veya uygulama bilgisi görüntülenir. Android ana ekranındaki beş kısayol da aynı kabuğu
   doğrudan hedef sayfada açar.
3. Chrome'a yalnızca **kullanıcı isterse** geçilir. Google ile giriş
   sorun yaşarsa “Chrome'da aç” kullanılabilir; normal panel, e-posta/şifre girişi,
   telemetri ve komutlar WebView içinde çalışır.
4. İnternet yoksa veya sayfa yüklenemezse yerel “Bağlantı kurulamadı” ekranı, “Tekrar
   dene” ve “Chrome'da aç” düğmeleri gösterilir.

Bu mimari, daha önceki **Trusted Web Activity (TWA)** sürümünün Chrome bulunmayan veya
Chrome'u kısıtlayan telefonlarda açılıp hemen kapanması nedeniyle seçildi. TWA çıktıları
referans için `android/dist/*-twa*` altında tutulur; yeni yayın WebView sürümüdür.

## Mobil uygulama deneyimi

Web arayüzü telefonda site gibi değil, uygulama gibi davranır:

- **5 sekmeli alt gezinme:** Panel, Telemetri, Savunma, Analitik, Ayarlar.
- **Başparmak dostu mod şeridi:** İzleme / Evde / Gece / Tatil modları üstte.
- **Canlı kokpit:** Telefonda tanıtım afişi yerine anlık durum, mod ve hızlı eylemler.
- **Yerel kabuk:** Aşağı çekerek yenileme, çift geri tuşuyla çıkış, yerel ⋮ menü,
  Android 12 açılış ekranı, durum çubuğu/klavye güvenli alanları.
- **Ana ekran kısayolları:** Panel, Telemetri, Savunma, Analitik, Ayarlar.
- **Dokunsal geri bildirim:** Destekleyen Android cihazlarda sekme/mod dokunuşlarında.
- **Gerçek telefon bildirimleri (FCM):** Uygulama kapalıyken bile gaz/alev/su/sarsıntı
  alarmı bildirilir. WebView'de çalışmayan Web Push'un yerini alır.
- **Canlı durum satırı:** Bildirim panelinde sessiz "son durum" satırı (gaz, mod, saat).
- **Ana ekran widget'ı:** Son bilinen durum + tek dokunuşla panel/Savunma.
- **Çevrimdışı dayanıklılık:** Son telemetri önbelleğe alınır; ağ yokken gösterilir,
  altta "Bağlantı yok · son veri 14:32" şeridi ve "Yeniden dene" düğmesi çıkar.
- **PDF olay raporu:** Olay günlüğü A4 PDF olarak üretilip Android paylaşım sayfasıyla
  gönderilir (CSV da mevcut).

Mobil kabuk dosyaları: `pwa/css/mobile-app.css`, `pwa/js/mobile-app.js`,
`pwa/js/offline.js`, `pwa/js/native-push.js`. Masaüstünde alt gezinme gizlenir;
üst gezinme kullanılır.

## Firebase / FCM kurulumu

FCM için Firebase projesinde Android uygulaması tanımlıdır:

- Proje: `ddproje-9f594`
- Android uygulaması: `com.mabiltekin.deneyapevkoruma`
- Yapılandırma: `android/app/google-services.json` (depoda, gizli anahtar içermez)

Gönderim `api/push.js` ve test uç noktası `api/notify.js` üzerinden Firebase Admin ile
yapılır. Vercel **Production** ortamında şu değişkenler tanımlıdır (değerler depoda
tutulmaz):

| Değişken | Görev |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Firestore + FCM servis hesabı JSON'u |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Tarayıcı/PWA Web Push |
| `PUSH_TRIGGER_SECRET` | Firmware'in `/api/push` çağrısını doğrular |

Sağlık kontrolü: `GET https://ddproje.vercel.app/api/push` yanıtında
`configured.fcm: true` ve `configured.vapid: true` görünmelidir.

> **Gerçek alarmlar için firmware ayarı:** FCM yalnızca sunucuya bildirim isteği
> geldiğinde gönderilir. `firmware-mqtt/DeneyapEvKoruma/config.h` içinde `PUSH_URL`
> (`https://ddproje.vercel.app/api/push`) ve `PUSH_SECRET` (Vercel'deki
> `PUSH_TRIGGER_SECRET` ile aynı) tanımlanmalı ve karta yüklenmelidir. Bu alanlar boşsa
> yalnızca paneldeki **Test bildirimi** çalışır; gerçek alarmda bildirim gitmez.

Token'lar `push_tokens` koleksiyonunda `platform: "android"` alanıyla saklanır. FCM
mesajları **data-only** gönderilir; bildirimi uygulama kendisi çizer. Böylece uygulama
kapalıyken de kanal, ses, titreşim ve alarm davranışı tutarlı olur.

Test bildirimi: web panelinde **Ayarlar → Android bildirimleri → Test bildirimi gönder**
veya oturum açmış istemciden `POST /api/notify`.

> **Force-stop notu:** Android, kullanıcı uygulamayı "Durdur" ile zorla kapatırsa
> bildirimler yeniden açılana kadar gelmez. Bu Android'in kendi kısıtıdır.

## Acil durum e-postaları

Ayarlar → **Acil Durum E-postaları** bölümünden en fazla 20 kişi eklenir. Kişiler
Firestore'da `emergency_contacts` koleksiyonunda `uid`, `name`, `email`, `enabled`
alanlarıyla tutulur; yalnızca hesap sahibi okuyup yazabilir. Paneldeki
**Test E-postası Gönder** düğmesi `POST /api/notify` (`emailTest: true`) çağırır.

Alarm anında `api/push.js`, önce istekteki `uid` alanına bakar; yoksa
`device_bindings/{device}.owner_id` üzerinden cihaz sahibini bulur ve o hesabın aktif
kişilerine e-posta gönderir. `test` türünde e-posta gönderilmez.

Vercel **Production** ortamına eklenmesi gerekenler:

| Değişken | Örnek / görev |
|---|---|
| `EMERGENCY_FROM` | `Deneyap Ev Koruma <alerts@alanadiniz.com>` |
| `RESEND_API_KEY` | Resend kullanılıyorsa API anahtarı |
| `BREVO_API_KEY` | Brevo kullanılıyorsa API anahtarı |

İki sağlayıcıdan biri yeterlidir; `RESEND_API_KEY` varsa Resend, yoksa Brevo denenir.
Gönderen adresi sağlayıcıda **doğrulanmış** olmalıdır. Anahtar yoksa panelde test
e-postası "Sunucuda e-posta servisi yapılandırılmadı" uyarısı verir; uygulamanın diğer
işlevleri çalışmaya devam eder.

## Gereksinimler

Bu makinede hazır:

- JDK 17: `C:\Users\mabil\.jdks\jbr-17.0.14`
- Android SDK: `C:\Users\mabil\AppData\Local\Android\Sdk` (platform 36 + build-tools 36.x)
- Gradle wrapper: `android/gradlew.bat` (Gradle 8.11.1)

`tools/build-android.ps1` bu yolları otomatik bulur. Başka bir makinede:

1. JDK 17 kurun ve `JAVA_HOME` ayarlayın.
2. Android Studio / SDK Manager ile **Android 16 (API 36)** ve build-tools kurun.
3. `ANDROID_HOME` veya `ANDROID_SDK_ROOT` ayarlayın (yoksa `%LOCALAPPDATA%\Android\Sdk` denenir).

## Derleme

```powershell
npm run android:all     # APK + AAB
npm run android:apk     # yalnızca APK
npm run android:aab     # yalnızca AAB (Play için)
npm run android:install # APK üret + bağlı cihaza kur (adb gerekir)
```

Proje yolu boşluk/Türkçe karakter içerdiği için derleme otomatik olarak ASCII bir kopyada
yapılır:

```
C:\dd-android-build\project
```

Çıktılar `android/dist/` klasörüne kopyalanır. `dist/`, APK ve AAB dosyaları `.gitignore`
içindedir; depoya commit edilmez.

İlk derlemede Gradle 8.11.1 indirilir (bir kez). Sonraki derlemeler önbellekten hızlıdır.

### İkonları yenileme

PWA ikonları (`pwa/icons/icon-512.png`, `maskable-512.png`) değişince:

```powershell
npm run android:icons
```

Bu komut mipmap'leri, Play ikonunu ve feature graphic'i yeniden üretir.

## İmza anahtarı (çok önemli)

Upload keystore depo dışında tutulur:

```
C:\Users\mabil\OneDrive\Desktop\dd uygulama\android-keys\deneyap-upload.jks
C:\Users\mabil\OneDrive\Desktop\dd uygulama\android-keys\KEYSTORE-INFO.txt
```

- `KEYSTORE-INFO.txt` içinde alias, parola ve SHA-256 parmak izi vardır.
- Yedek: `C:\Users\mabil\AppData\Local\dd-android\`
- `android/keystore.properties` bu dosyaya işaret eder; **git'e girmez**.
- **Bu anahtarı ve parolayı kaybetmeyin.** Play Console'da upload key sıfırlama
  yapılabilir; ancak süreç uzun ve risklidir.
- Anahtar üretimi (yalnızca yoksa): `npm run android:keystore`. `-Force` mevcut anahtarı
  yedekleyip yenisini üretir; **yayınlanmış uygulamada kullanmayın.**

Upload anahtarı SHA-256:

```
83:1C:1E:F6:B9:25:19:06:37:4D:CD:43:CF:EB:FC:E4:D2:53:3D:63:12:7A:17:FB:FB:61:35:AD:EF:A0:6F:92
```

## Play Store'a yükleme akışı

1. Play Console'da **Create app**:
   - App name: `Deneyap Ev Koruma`
   - Default language: Türkçe
   - App or game: App
   - Free
2. **Package name** mutlaka `com.mabiltekin.deneyapevkoruma` olmalı. İlk yüklemeden sonra
   değiştirilemez. Paket adı değişecekse `android/gradle.properties` → `twaPackage` ve
   Java kaynaklarındaki `package` satırları birlikte güncellenmelidir; aksi hâlde uygulama
   açılmaz. Mevcut paket adını korumanız önerilir.
3. **Internal testing** track'ine `DeneyapEvKoruma-2.23.0-release.aab` yükleyin.
4. Play App Signing'i etkinleştirin. **Mevcut WebView mimarisi için Play App Signing
   SHA-256'sını `assetlinks.json`'a eklemek gerekmez.** Bu dosya yalnızca ileride TWA'ya
   dönülürse gerekir.
5. Internal testing bağlantısıyla telefona kurun; aşağıdakileri test edin:
   - Uygulama doğrudan tam ekran WebView'de açılıyor; adres çubuğu görünmüyor.
   - Yerel ⋮ menü: Yenile, Chrome'da aç, bağlantı paylaş, hakkında.
   - Ana ekran kısayolları doğru sayfayı açıyor.
   - Beş sekmeli alt gezinme, mod şeridi ve canlı kokpit.
   - Giriş / kayıt / e-posta doğrulama; gerekirse Chrome'da aç.
   - Cihaz listesi, telemetri, komut gönderme.
   - Bildirim izni ve bildirim alma (destekleniyorsa Chrome yolunda).
   - Çevrimdışıyken son önbellek açılıyor; hata ekranı düzgün görünüyor.
   - Aşağı çekerek yenileme, geri tuşu, döndürme, klavye, dosya seçme.
6. Store listing, privacy policy, data safety, content rating, app access bölümlerini
   doldurun. Ayrıntılı kontrol listesi: `PLAY-STORE.md`.
7. Production'a kademeli rollout (ör. %20 → %50 → %100).

> Yandan yüklenen APK ile Play'den kurulan sürümün imzaları farklıdır. Play sürümünü
> kurmadan önce yandan yüklenen uygulamayı kaldırın.

## Sürüm yönetimi

Web ve Android sürümleri ayrıdır:

- **Web sürümü:** `package.json`, `pwa/js/config.js`, `pwa/sw.js`, `firmware/config.h`
  ve HTML başlıkları birlikte artırılır (`npm run check` doğrular).
- **Android `versionName`:** `android/gradle.properties` → `appVersionName`.
- **Android `versionCode`:** `android/gradle.properties` → `appVersionCode`. Play'e her
  yüklemede **mutlaka** artırın (2, 3, 4…). Aynı kodla ikinci yükleme reddedilir.

Web'de yeni özellik çıkınca Android `versionCode` artırmak **gerekmez**; uygulama canlı
siteyi açar. Yalnızca Android tarafı değişince (ikon, isim, paket, izin, başlangıç adresi,
tarayıcı/WebView kodu) yeni AAB gerekir.

## Yapı

```
android/
  settings.gradle
  build.gradle
  gradle.properties          # URL, paket, versionCode/versionName
  gradlew / gradlew.bat      # Gradle 8.11.1 wrapper
  keystore.properties        # GİZLİ — git'e girmez
  app/
    build.gradle
    src/main/AndroidManifest.xml
    src/main/java/com/mabiltekin/deneyapevkoruma/
      MainActivity.java              # başlatıcı; kısayol yönlendirme + Chrome yedeği
      WebViewActivity.java           # tam ekran WebView, yerel menü, JS köprüsü
      AppNotifications.java          # kanallar, izin, canlı durum bildirimi
      DeneyapMessagingService.java   # FCM alımı + token yenileme
      StatusWidgetProvider.java      # ana ekran widget'ı
      ReportPdf.java                 # A4 PDF raporu + paylaşım
    src/main/res/layout/widget_status.xml  # widget düzeni
    src/main/res/xml/shortcuts.xml         # Android ana ekran kısayolları
    src/main/res/xml/widget_status_info.xml
    src/main/res/xml/file_paths.xml        # PDF paylaşımı için FileProvider
    src/main/res/values/strings.xml        # uygulama adı + kısayol etiketleri
    src/main/res/values/colors.xml
    src/main/res/values/styles.xml         # Android 12 açılış teması
    src/main/res/mipmap-*/                 # ikonlar
  play/                      # Play görselleri
  dist/                      # APK/AAB çıktıları (git dışı)
pwa/.well-known/assetlinks.json   # yalnızca ileride TWA için; mevcut uygulama kullanmaz
tools/build-android.ps1
tools/android-icons.ps1
tools/android-keystore.ps1
```

## Sık değişen ayarlar

| Değişiklik | Yer |
|---|---|
| Site adresi | `android/gradle.properties` → `twaUrl` |
| Paket adı | `android/gradle.properties` → `twaPackage` + Java `package` satırları |
| Uygulama adı | `android/app/src/main/res/values/strings.xml` → `app_name` |
| Sürüm | `android/gradle.properties` → `appVersionCode`, `appVersionName` |
| İkonlar | `pwa/icons/` + `npm run android:icons` |
| Başlangıç rengi | `res/values/colors.xml`, `styles.xml` |
| İmza | `android/keystore.properties` (git dışı) |

`gradle.properties` içindeki `twaUrl` ve `twaPackage` isimleri eski TWA
yapılandırmasından kalmıştır; mevcut uygulamada sırasıyla **başlangıç adresi** ve
**uygulama paketi** olarak kullanılır.

## Sorun giderme

**Uygulama Chrome'da ve üstte adres çubuğuyla açılıyor**
- Normalde beklenen davranış değildir. Yalnızca yerel ⋮ menüden veya “Chrome'da aç”
  kısayolundan Chrome'a geçilirse adres çubuğu görünür.
- Sürekli Chrome açılıyorsa eski (2.21.x veya TWA) sürüm kurulu olabilir. Eski uygulamayı
  kaldırıp `DeneyapEvKoruma-2.23.0-release.apk` dosyasını temiz kurun.

**Uygulama tam ekran WebView'de açılıyor**
- Beklenen davranış budur. Adres çubuğu yoktur; site yerel uygulama gibi çalışır.
- Google ile giriş sorun yaşarsa ⋮ menüsünden **Chrome'da aç** seçin.
- Push bildirimleri WebView'de değil, yerel FCM servisiyle çalışır; Chrome gerekmez.
- Android 13+ için izin, Ayarlar → Android bildirimleri bölümünde bildirimler
  açılırken istenir. İzin verilmezse sistem ayarlarından da açılabilir.

**Uygulama hâlâ açılıp hemen kapanıyor**
- Önce eski sürümü kaldırıp yeni APK'yı temiz kurun.
- Cihaz modeli, Android sürümü ve tam belirtiyi bildirin.
- Mümkünse `adb logcat` çıktısını alın; hata varsa buradan görülür.

**Derleme Java 8'i kullanıyor**
- `JAVA_HOME` JDK 17'yi göstermeli. Script JBR 17'yi otomatik bulur; PATH'teki `java`
  eski olabilir. `npm run android:all` script'i doğru Java'yı kullanır.

**Gradle wrapper indiremiyor**
- İnternet erişimi gerekir. Kurumsal proxy varsa `GRADLE_OPTS` / `HTTPS_PROXY` ayarlayın.
- Alternatif: `C:\dd-android-build\gradle-8.11.1` gibi yerel Gradle ile
  `gradle :app:assembleRelease`.

**`SDK location not found`**
- `ANDROID_HOME` veya `%LOCALAPPDATA%\Android\Sdk` gerekir; script `local.properties`
  dosyasını ASCII kopyada otomatik yazar.

**OneDrive kilitleri / yol sorunları**
- Derleme `C:\dd-android-build\project` kopyasında yapılır. OneDrive'ı duraklatmak
  gerekmez; ancak dosyaları aynı anda düzenlemeyin.

**Uygulama açılıyor ama site yüklenmiyor**
- İnternet ve `https://ddproje.vercel.app/` erişimini kontrol edin.
- Yerel hata ekranındaki **Tekrar dene** düğmesini kullanın.
- WebView bazı PWA özelliklerini (bazı Google giriş akışları) desteklemeyebilir;
  ⋮ menüsünden Chrome'da açın.

**Bildirimler gelmiyor**
- Android 13+ için bildirim izni verilmeli (Ayarlar → Android bildirimleri).
- Pil optimizasyonu uygulamayı kısıtlıyorsa bildirimler gecikebilir; uygulamayı
  "Kısıtlanmamış" listesine ekleyin.
- Uygulama "Durdur" ile zorla kapatıldıysa Android yeniden açılana kadar FCM teslim
  etmez. Uygulamayı açıp tekrar deneyin.
- Web panelinde **Ayarlar → Android bildirimleri → Test bildirimi gönder** ile sunucu
  tarafını doğrulayın. `GET /api/push` yanıtında `fcm: true` görünmelidir.
- FCM token'ı hesaba bağlıdır; farklı hesapla giriş yapıldıysa bildirim o hesaba gelir.

## Test durumu

Bu paket bu makinede **derlendi ve imzası doğrulandı**. Mobil arayüz Chrome DevTools
protokolüyle 390×844 (telefon), 800×1000 (tablet) ve 1440×900 (masaüstü) boyutlarında
doğrulandı; sahte Android köprüsüyle yerel menü, canlı kokpit, Android bildirim ayarları,
PDF rapor modeli ve çevrimdışı şerit test edildi. `npm run check`, `npm run verify` ve
`npm run build` geçti.

Bağlı gerçek Android cihaz/emülatör olmadığından şunlar bu makinede **doğrulanamadı**:
FCM bildirim teslimi, Android 13+ izin akışı, canlı durum bildirimi, ana ekran widget'ı,
PDF paylaşım sayfası, önbellekli soğuk açılış, klavye ve döndürme. Yayın öncesi en az bir
gerçek telefonda internal testing ile bu liste test edilmelidir.

## İlgili dosyalar

- `PLAY-STORE.md` — mağaza metinleri, data safety, inceleme hesabı ve yayın kontrol listesi
- `pwa/privacy.html` — gizlilik ve hesap silme politikası
- `pwa/.well-known/assetlinks.json` — yalnızca ileride TWA kullanılırsa gerekli doğrulama dosyası
