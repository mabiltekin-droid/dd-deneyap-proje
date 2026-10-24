# Android Uygulaması (APK / AAB)

Deneyap Ev Koruma'nın Android paketi. Uygulama, canlı PWA'yı **Chrome Custom Tabs**
ile açar; Chrome yoksa, devre dışıysa veya Chrome hemen kapanırsa **dahili WebView**
yedek görünümüne geçer. Böylece uygulama, Chrome bulunmayan/engelli telefonlarda da
açılır. Web tarafında yapılan değişiklikler **yeni APK üretmeden** uygulamaya yansır;
APK yalnızca Android tarafı (ikon, isim, paket, izinler, sürüm, başlangıç adresi)
değişince yeniden üretilir.

- **Paket adı:** `com.mabiltekin.deneyapevkoruma`
- **Uygulama adı:** Deneyap Ev Koruma
- **Web adresi:** https://ddproje.vercel.app/
- **Sürüm:** 2.21.0 — `versionCode 2`
- **minSdk:** 24 (Android 7.0+) · **targetSdk / compileSdk:** 36 (Android 16)
- **Mimari:** Tek, evrensel APK. Telefon/tablet için ayrı APK gerekmez; PWA responsive'dir.

## Hazır çıktılar

Derleme sonrası:

| Dosya | Kullanım |
|---|---|
| `android/dist/DeneyapEvKoruma-2.21.0-release.apk` | Telefona doğrudan kurulum / test |
| `android/dist/DeneyapEvKoruma-2.21.0-release.aab` | **Google Play'e yükleme** |
| `android/play/icon-512.png` | Play Store uygulama ikonu |
| `android/play/feature-graphic-1024x500.png` | Play Store öne çıkan görsel |
| `android/play/screenshots/` | Telefon ekran görüntüleri (v2.21.0) |

Bu derlemenin SHA-256 özetleri:

```
APK: F9640B6F2A6FBBA956E130B44E476ECB18D6F2C064CD9A93FFB84F458F2E7107
AAB: 86E7E766C24BA6A1BE9D3DF030D29EFFCD8C7E4537B3394FAD0E0F806C79F582
```

> Yeniden derlemede bu özetler değişir. Play Store'a her yüklemede `appVersionCode`
> değerini artırın.

## Nasıl açılıyor?

1. Uygulama açılır, Chrome (veya Custom Tabs destekli başka bir tarayıcı) aranır.
2. Chrome varsa site Chrome'un **Custom Tabs** görünümünde açılır. Bu yolda Google ile
   giriş, web push bildirimleri ve Chrome oturumu normal çalışır. Üstte **adres çubuğu
   görünebilir**; bu, Custom Tabs'in normal davranışıdır.
3. Chrome yoksa, devre dışıysa veya Chrome açıldıktan hemen sonra kapanırsa uygulama
   otomatik olarak **dahili WebView** görünümüne geçer. Bu görünümde site yine açılır;
   ancak Google ile giriş ve web push bazı cihazlarda çalışmayabilir. E-posta/şifre
   girişi ve panel işlevleri kullanılabilir.

Bu mimari, daha önceki **Trusted Web Activity (TWA)** sürümünün Chrome bulunmayan veya
Chrome'u kısıtlayan telefonlarda açılıp hemen kapanması nedeniyle seçildi. TWA'nın
tam ekran (adres çubuksuz) görünümü ileride tekrar değerlendirilebilir; ancak mevcut
öncelik uygulamanın her cihazda açılmasıdır.

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
3. **Internal testing** track'ine `DeneyapEvKoruma-2.21.0-release.aab` yükleyin.
4. Play App Signing'i etkinleştirin. **Mevcut Custom Tabs + WebView mimarisi için Play
   App Signing SHA-256'sını `assetlinks.json`'a eklemek gerekmez.** Bu dosya yalnızca
   ileride TWA'ya dönülürse gerekir.
5. Internal testing bağlantısıyla telefona kurun; aşağıdakileri test edin:
   - Uygulama açılıyor; Chrome'da veya dahili görünümde site yükleniyor.
   - Giriş / kayıt / e-posta doğrulama.
   - Cihaz listesi, telemetri, komut gönderme.
   - Bildirim izni ve bildirim alma (Chrome yolunda).
   - Çevrimdışıyken son önbellek açılıyor.
   - Geri tuşu, döndürme, klavye, dosya seçme.
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
      MainActivity.java      # Chrome Custom Tabs + WebView yedeği
      WebViewActivity.java   # Dahili görünüm, dosya seçme, indirme
    src/main/res/values/strings.xml       # uygulama adı
    src/main/res/values/colors.xml
    src/main/res/values/styles.xml
    src/main/res/mipmap-*/                # ikonlar
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
- Beklenen davranış. Mevcut sürüm Chrome Custom Tabs kullanır; adres çubuğu görünür.
- Adres çubuksuz tam ekran isteniyorsa TWA'ya dönmek gerekir; ancak TWA bazı
  telefonlarda (Chrome yok/engelli) açılmıyordu. Önce mevcut sürümün açılmasını
  doğrulayın.

**Uygulama dahili görünümde açılıyor**
- Telefonda Chrome yok, devre dışı veya Chrome hemen kapanıyor. Uygulama bu yüzden
  WebView yedeğine geçti.
- Chrome'u kurun/güncelleyin ve uygulamayı yeniden açın. Bu yol Google ile giriş ve web
  push bildirimleri için daha iyidir.
- Dahili görünümde Google ile giriş çalışmazsa e-posta/şifre ile giriş yapın veya
  Chrome'u kurun.

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
- Dahili görünümde "Tekrar dene" düğmesi vardır.
- Chrome yoksa WebView yedeği devreye girer; bazı PWA özellikleri (push, Google girişi)
  çalışmayabilir.

**Bildirimler gelmiyor**
- Android 13+ için bildirim izni verilmeli.
- PWA'da bildirim aboneliği ve VAPID anahtarı ayarlı olmalı (`npm run vapid`).
- Chrome arka planda kısıtlanmış olabilir; pil optimizasyonunu kontrol edin.
- Dahili WebView görünümü web push bildirimlerini desteklemez; Chrome yolunu kullanın.

## Test durumu

Bu paket bu makinede **derlendi ve imzası doğrulandı**. WebView tanılama APK'sı gerçek
bir telefonda açıldı; ancak bu Custom Tabs + WebView sürümü için bağlı cihaz/emülatör
olmadığından kurulum/açılış testi bu makinede yapılamadı. Yayın öncesi en az bir gerçek
telefonda internal testing ile test edin.

## İlgili dosyalar

- `PLAY-STORE.md` — mağaza metinleri, data safety, inceleme hesabı ve yayın kontrol listesi
- `pwa/privacy.html` — gizlilik ve hesap silme politikası
- `pwa/.well-known/assetlinks.json` — yalnızca ileride TWA kullanılırsa gerekli doğrulama dosyası
