# Android Uygulaması (APK / AAB)

Deneyap Ev Koruma'nın Android paketi. Uygulama, canlı PWA'yı **Trusted Web Activity (TWA)**
ile tam ekran açar. Böylece web tarafında yapılan değişiklikler **yeni APK üretmeden**
uygulamaya yansır; APK yalnızca Android tarafı (ikon, isim, paket, izinler, sürüm) değişince
yeniden üretilir.

- **Paket adı:** `com.mabiltekin.deneyapevkoruma`
- **Uygulama adı:** Deneyap Ev Koruma
- **Web adresi:** https://ddproje.vercel.app/
- **Sürüm:** 2.21.0 — `versionCode 1`
- **minSdk:** 24 (Android 7.0+) · **targetSdk / compileSdk:** 36 (Android 16)
- **Mimari:** Tek, evrensel APK. Telefon/tablet için ayrı APK gerekmez; PWA responsive'dir.
  İkinci bir marka/uygulama istenirse aynı proje farklı `twaPackage` ve uygulama adıyla
  kopyalanabilir.

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
APK: 031E265B04C6BF3CB90639A293CDBDCFDB4B0CB2BC7EEF319F87030AFDED0B97
AAB: BB927ACAAE402B7A713859A2321AFB54592BE8E21565FE2BD6C8F4EE9138BF05
```

> Yeniden derlemede bu özetler değişir. Play Store'a her yüklemede `appVersionCode`
> değerini artırın.

## Neden TWA?

- Web güncellemeleri anında gelir; her özellik için Play'e yeni sürüm göndermek gerekmez.
- Chrome'un güvenli tarayıcı motorunu kullanır; WebView'e göre daha güncel ve güvenlidir.
- Adres çubuğu, `assetlinks.json` doğrulaması yapıldığında görünmez.
- Chrome yoksa veya TWA açılamazsa WebView yedeğine düşer (URL çubuğu görünebilir).

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

## TWA doğrulaması / assetlinks

Sunucuda şu dosya olmalı:

```
https://ddproje.vercel.app/.well-known/assetlinks.json
```

Depodaki kaynak: `pwa/.well-known/assetlinks.json`. İçinde yukarıdaki upload anahtarı
parmak izi vardır. Web'e yayınlamak için:

```powershell
npm run build
# public/.well-known/assetlinks.json oluşur; commit + push → Vercel yayını
```

**Play App Signing:** Play, AAB'yi kendi anahtarıyla yeniden imzalar. İlk AAB yüklemesinden
sonra Play Console → **Setup → App signing** bölümündeki **App signing key certificate**
SHA-256 değerini `pwa/.well-known/assetlinks.json` içindeki listeye ekleyin; sonra web'i
yeniden yayınlayın. TWA doğrulaması için **sunucudaki bu dosya yeterlidir**. İsterseniz
`android/app/src/main/res/values/strings.xml` içindeki kopyayı da güncelleyebilirsiniz;
ancak bu, yeni bir AAB (artırılmış `versionCode`) gerektirir ve Play doğrulaması için
zorunlu değildir. Aksi hâlde Play'den kurulan uygulamada adres çubuğu görünür.

Doğrulama:

```powershell
# Sunucu tarafı
curl.exe https://ddproje.vercel.app/.well-known/assetlinks.json

# Cihaz tarafı (bağlı cihaz varsa)
adb shell pm get-app-links com.mabiltekin.deneyapevkoruma
adb shell pm verify-app-links --re-verify com.mabiltekin.deneyapevkoruma
```

Doğrulama tamamlanana kadar uygulama çalışır; yalnızca üstte URL çubuğu görünür.
Birkaç saat/gün sürebilir; Chrome'u güncelleyin, uygulamayı yeniden kurun.

## Play Store'a yükleme akışı

1. Play Console'da **Create app**:
   - App name: `Deneyap Ev Koruma`
   - Default language: Türkçe
   - App or game: App
   - Free
2. **Package name** mutlaka `com.mabiltekin.deneyapevkoruma` olmalı. İlk yüklemeden sonra
   değiştirilemez. Farklı bir paket kullanacaksanız **önce** `android/gradle.properties`
   içindeki `twaPackage` değerini, `strings.xml` asset statements'i ve `assetlinks.json`'u
   güncelleyip yeniden derleyin.
3. **Internal testing** track'ine `DeneyapEvKoruma-2.21.0-release.aab` yükleyin.
4. Play App Signing'i etkinleştirin; App signing SHA-256'yı alın.
5. Bu parmak izini `assetlinks.json` + `strings.xml`'e ekleyin, `npm run build` + push.
6. Internal testing bağlantısıyla telefona kurun; aşağıdakileri test edin:
   - Uygulama açılıyor, adres çubuğu yok (doğrulama sonrası).
   - Giriş / kayıt / e-posta doğrulama.
   - Cihaz listesi, telemetri, komut gönderme.
   - Bildirim izni ve bildirim alma.
   - Çevrimdışıyken son önbellek açılıyor.
   - Geri tuşu, döndürme, klavye, dosya seçme.
7. Store listing, privacy policy, data safety, content rating, app access bölümlerini
   doldurun. Ayrıntılı kontrol listesi: `PLAY-STORE.md`.
8. Production'a kademeli rollout (ör. %20 → %50 → %100).

## Sürüm yönetimi

Web ve Android sürümleri ayrıdır:

- **Web sürümü:** `package.json`, `pwa/js/config.js`, `pwa/sw.js`, `firmware/config.h`
  ve HTML başlıkları birlikte artırılır (`npm run check` doğrular).
- **Android `versionName`:** `android/gradle.properties` → `appVersionName`.
- **Android `versionCode`:** `android/gradle.properties` → `appVersionCode`. Play'e her
  yüklemede **mutlaka** artırın (1, 2, 3…). Aynı kodla ikinci yükleme reddedilir.

Web'de yeni özellik çıkınca Android `versionCode` artırmak **gerekmez**; TWA canlı siteyi
açar. Yalnızca Android tarafı değişince (ikon, isim, paket, izin, TWA kütüphanesi) yeni
AAB gerekir.

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
    src/main/res/values/strings.xml       # uygulama adı + asset statements
    src/main/res/values/colors.xml
    src/main/res/values/styles.xml
    src/main/res/values-v31/styles.xml    # Android 12 splash
    src/main/res/drawable/splash*.xml
    src/main/res/mipmap-*/                # ikonlar
    src/main/res/xml/file_paths.xml
  play/                      # Play görselleri
  dist/                      # APK/AAB çıktıları (git dışı)
pwa/.well-known/assetlinks.json
tools/build-android.ps1
tools/android-icons.ps1
tools/android-keystore.ps1
```

## Sık değişen ayarlar

| Değişiklik | Yer |
|---|---|
| Site adresi | `android/gradle.properties` → `twaUrl`, `twaHost` |
| Paket adı | `android/gradle.properties` → `twaPackage` + `strings.xml` + `assetlinks.json` |
| Uygulama adı | `android/app/src/main/res/values/strings.xml` → `app_name` |
| Sürüm | `android/gradle.properties` → `appVersionCode`, `appVersionName` |
| İkonlar | `pwa/icons/` + `npm run android:icons` |
| Başlangıç rengi | `res/values/colors.xml`, `styles.xml` |
| İmza | `android/keystore.properties` (git dışı) |

Paket adı değişince `asset_statements` içindeki `package_name` de değişmeli; yoksa TWA
doğrulaması başarısız olur.

## Sorun giderme

**Üstte adres çubuğu görünüyor**
- `https://ddproje.vercel.app/.well-known/assetlinks.json` gerçekten 200 mü?
- Paket adı ve parmak izi birebir aynı mı? (Play'den kurulan sürümde Play App Signing
  parmak izi gerekir.)
- Uygulama Play'den mi, yoksa yerel APK'dan mı kurulu? İkisinin imzası farklıdır.
- Chrome'u güncelleyin, uygulamayı kaldırıp yeniden kurun; birkaç saat bekleyin.
- `adb shell pm verify-app-links --re-verify com.mabiltekin.deneyapevkoruma`

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
- Chrome yoksa WebView yedeği devreye girer; bazı PWA özellikleri (push, TWA tam ekran)
  çalışmayabilir.

**Bildirimler gelmiyor**
- Android 13+ için bildirim izni verilmeli.
- PWA'da bildirim aboneliği ve VAPID anahtarı ayarlı olmalı (`npm run vapid`).
- Chrome arka planda kısıtlanmış olabilir; pil optimizasyonunu kontrol edin.

## Test durumu

Bu paket bu makinede **derlendi ve imzası doğrulandı**; ancak bağlı bir Android cihaz
veya emülatör olmadığı için **kurulum/açılış testi yapılmadı**. Yayın öncesi en az bir
gerçek telefonda internal testing ile test edin.

## İlgili dosyalar

- `PLAY-STORE.md` — mağaza metinleri, data safety, inceleme hesabı ve yayın kontrol listesi
- `pwa/privacy.html` — gizlilik ve hesap silme politikası
- `pwa/.well-known/assetlinks.json` — TWA doğrulama dosyası
