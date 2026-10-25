# Google Play Yayın Kontrol Listesi

Bu dosya, `Deneyap Ev Koruma` Android uygulamasını Play Store'a yüklerken gereken
metinleri, veri güvenliği cevaplarını ve yayın öncesi kontrolleri toplar.

> Bu bir hukuk metni değildir. Gizlilik politikası ve veri güvenliği cevapları
> yayından önce kendi veri akışınıza göre gözden geçirilmelidir.

## 1. Uygulama künyesi

| Alan | Değer |
|---|---|
| Uygulama adı | Deneyap Ev Koruma |
| Paket adı | `com.mabiltekin.deneyapevkoruma` |
| Sürüm | 2.22.0 (`versionCode 3`) |
| Kategori | House & Home (yoksa Tools) |
| Etiketler | Akıllı ev, güvenlik, IoT |
| Ücret | Ücretsiz |
| Reklam | Yok |
| Uygulama içi satın alma | Yok |
| Geliştirici iletişim | GitHub Issues (Play Console'a ayrıca e-posta ekleyin) |
| Gizlilik politikası | `https://ddproje.vercel.app/privacy.html` |
| Hesap silme | `https://ddproje.vercel.app/privacy.html#hesap-silme` |
| Web sitesi | `https://ddproje.vercel.app/` |
| Destek | `https://github.com/mabiltekin-droid/dd-deneyap-proje/issues` |

**Play Console'da geliştirici e-postası zorunludur.** GitHub adresi tek başına yeterli
değildir; kendi e-posta adresinizi ekleyin. İsterseniz aynı adresi gizlilik sayfasına da
ekleyin.

## 2. Mağaza metinleri

### Kısa açıklama (67 karakter)

```
ESP32 ev güvenlik paneli: sensörler, cihaz kontrolü ve bildirimler.
```

### Tam açıklama

```
Deneyap Ev Koruma, ESP32 tabanlı ev güvenlik sisteminizi telefondan ve tabletten
yönetmenizi sağlayan bir kontrol panelidir.

Canlı telemetri:
• Sıcaklık, nem, gaz, duman, hareket ve yağmur sensörlerini tek ekranda izleyin.
• Bağlantı durumu, sinyal kalitesi ve cihaz sağlığını görün.
• Grafikler ve olay geçmişiyle değişimleri takip edin.

Kontrol ve otomasyon:
• Röle, fan, ışık ve alarm çıkışlarını yönetin.
• Zamanlama ve sensör eşiklerine göre otomatik kurallar oluşturun.
• Gece, tatil ve izleme modları arasında geçiş yapın.

Güvenlik:
• E-posta doğrulamalı hesap, rol tabanlı yetkilendirme ve davet sistemi.
• Cihaz sahipliği doğrulaması; her kullanıcı yalnızca kendi cihazını görür.
• Kritik işlemlerde yeniden doğrulama ve denetim kayıtları.

Bildirimler ve çevrimdışı kullanım:
• Hareket, gaz, sıcaklık ve bağlantı kopması bildirimleri.
• PWA desteği sayesinde son veriler çevrimdışıyken de görüntülenebilir.
• Android uygulaması canlı paneli tam ekran, adres çubuksuz açar; web güncellemeleri
  anında gelir.
• Beş sekmeli mobil gezinme, hızlı mod şeridi, canlı kokpit, aşağı çekerek yenileme
  ve ana ekran kısayolları.

Not: Uygulama, Deneyap Kart tabanlı bir donanım ve Firebase/MQTT altyapısıyla birlikte
çalışır. Cihaz bağlanmadan da hesap ve panel ekranları görüntülenebilir; sensör verileri
için donanım bağlantısı gerekir.
```

### Sürüm notu (ilk yayın)

```
Deneyap Ev Koruma 2.22.0:
• Tam ekran, adres çubuksuz yeni Android uygulaması.
• Beş sekmeli mobil gezinme ve hızlı mod şeridi.
• Canlı kokpit, aşağı çekerek yenileme ve ana ekran kısayolları.
• Canlı telemetri, cihaz kontrolü, otomasyon ve bildirimler tek uygulamada.
```

## 3. Görseller

| Görsel | Dosya | Boyut | Durum |
|---|---|---|---|
| Uygulama ikonu | `android/play/icon-512.png` | 512×512 | Hazır |
| Feature graphic | `android/play/feature-graphic-1024x500.png` | 1024×500 | Hazır |
| Telefon ekran görüntüsü 1 | `android/play/screenshots/phone-01.png` | 1080×1920 (9:16) | Hazır (2.22.0 kokpit) |
| Telefon ekran görüntüsü 2 | `android/play/screenshots/phone-02-telemetry.png` | 1080×1920 (9:16) | Hazır (2.22.0 telemetri) |
| Telefon ekran görüntüsü 3 | `android/play/screenshots/phone-03-settings.png` | 1080×1920 (9:16) | Hazır (2.22.0 ayarlar) |

Play Store en az **2 telefon ekran görüntüsü** ister; üç yeni 9:16 görüntü hazırdır.
Görüntüler 360×640 CSS görünümünün 3× ölçeğinde alındı; beş sekmeli alt gezinme, mod
şeridi ve canlı kokpit görünür. Tablet için 7"/10" ekran görüntüleri de eklenebilir
(zorunlu değil).

Ekran görüntülerini yenilemek için Chrome DevTools → **Device toolbar**:

- Boyut: **360×640**, Device pixel ratio: **3** (çıktı 1080×1920, 9:16).
- Sayfa: `https://ddproje.vercel.app/`; kokpit için en üst, telemetri için Telemetri
  sekmesi, ayarlar için `/settings.html`.
- Tarayıcı chrome'unu gizleyip yalnızca sayfa alanını yakalayın.
- Android uygulamasındaki yerel ⋮ menüsünü göstermek için gerçek cihazdan ekran görüntüsü
  almak en doğrusudur; web görüntüsünde menü görünmez.

## 4. App access (inceleme erişimi)

Uygulamanın bazı bölümleri giriş gerektirir. Play Console → **App access**:

- “All or some functionality is restricted” seçin.
- İnceleme hesabı oluşturun:
  1. Firebase Console → Authentication → **Add user** (veya uygulamadaki admin paneli).
  2. E-posta doğrulamasını tamamlayın (`emailVerified = true`).
  3. Firestore'da `role: "user"` profilini oluşturun.
  4. Mümkünse bir demo cihaz atayın veya örnek telemetri bulunan bir demo hesap hazırlayın.
- Play Console'a **e-posta + şifre** ve adım adım giriş talimatı yazın.
- Şifreyi repoya, README'ye veya ekran görüntüsüne **koymayın**; inceleme sonrası
  değiştirin.
- E-posta doğrulaması zorunlu olduğu için inceleme hesabının posta kutusuna erişiminiz
  olmalıdır.

İnceleme notu örneği:

```
1) Uygulamayı açın.
2) Ayarlar > Hesap & Roller bölümüne gidin.
3) Aşağıdaki inceleme hesabıyla giriş yapın.
4) Genel Bakış ve Telemetri sekmelerinde panel görünür.
5) Cihaz bağlı değilse "Bağlantı yok" durumu normaldir; demo cihaz için
   ayrıca bilgi verilmiştir.
E-posta: <play-review@...>
Şifre: <Play Console'a girilecek>
```

## 5. Data safety (Veri güvenliği) önerisi

Play Console formunda aşağıdaki tabloyu kendi akışınıza göre doğrulayın.

| Veri türü | Toplanıyor | Paylaşılıyor | Zorunlu | Amaç |
|---|---|---|---|---|
| E-posta adresi | Evet | Hizmet sağlayıcı (Firebase) | Evet | Hesap, kimlik doğrulama, güvenlik |
| Ad (görünen ad) | Evet | Hizmet sağlayıcı | Hayır | Profil, cihaz sahipliği |
| Cihaz veya diğer kimlikler | Evet | Hizmet sağlayıcı | Evet | Cihaz eşleştirme, push aboneliği, güvenlik |
| Uygulama etkinliği | Evet | Hizmet sağlayıcı | Evet | Telemetri, komutlar, olay günlükleri, otomasyon |
| Uygulama bilgileri ve performans | Evet | Hizmet sağlayıcı | Hayır | Hata ayıklama, kötüye kullanım tespiti |
| Yaklaşık konum | Hayır* | Hayır | Hayır | Gün doğumu/batımı yalnızca cihazda; sunucuya gönderilmez |

\* Kullanıcı “Konumumu Kullan” derse koordinatlar yalnızca tarayıcı yerel depolamasında
tutulur. Bu davranış değişirse formu güncelleyin.

Cevaplar:

- **Veriler şifreli olarak iletilir mi?** Evet (HTTPS).
- **Kullanıcı verilerinin silinmesini talep edebilir mi?** Evet.
- **Veri satışı / reklam amaçlı paylaşım:** Hayır.
- **Reklam:** Uygulamada reklam yok.
- **Hesap oluşturma:** Evet, e-posta ile.
- **Veri toplama isteğe bağlı mı?** Hesap ve cihaz verileri hizmet için zorunlu;
  görünen ad ve bildirimler isteğe bağlı.
- **Veri işleyen hizmet sağlayıcılar:** Google Firebase/Cloud, Vercel, tarayıcı push
  servisi. Play formunda “shared” tanımına göre işaretleyin; reklam ortağı değildir.

## 6. Content rating (İçerik derecelendirmesi)

Ankette aşağıdaki cevaplar beklenir:

- Şiddet, cinsellik, küfür, kumar, uyuşturucu: **Yok**
- Kullanıcılar arası serbest içerik/paylaşım: **Yok** (cihaz adları ve özel günlükler
  yalnızca hesap sahibine görünür)
- Konum paylaşımı: **Yok**
- Dijital satın alma: **Yok**
- Reklam: **Yok**
- Kullanıcı etkileşimi: **Var** (davet, yönetici/kullanıcı rolleri) → “Users can interact”
  işaretlenebilir; ancak herkese açık sosyal akış yoktur.
- Sonuç genellikle **Everyone / 3+** olur.

## 7. Target audience ve diğer beyanlar

- **Hedef kitle:** 18+ (ev güvenliği ve IoT konsolu; çocuklara yönelik değil).
- **Çocuklara yönelik mi?** Hayır.
- **Haber uygulaması mı?** Hayır.
- **Devlet uygulaması mı?** Hayır.
- **Finansal özellik var mı?** Hayır.
- **Sağlık özelliği var mı?** Hayır.
- **COVID-19 uygulaması mı?** Hayır.
- **WebView / yerel kabuk:** Uygulama, canlı PWA'yı tam ekran WebView içinde açar;
  Chrome'a yalnızca kullanıcı isterse geçer. “Sadece web sitesi” değildir; yerel menü,
  aşağı çekerek yenileme, ana ekran kısayolları, çevrimdışı PWA, cihaz kontrolü ve
  donanım entegrasyonu içerir. Mağaza metninde bu işlevleri vurgulayın.

## 8. Hesap silme politikası

Uygulama içi yol:

```
Ayarlar → Hesap & Roller → Hesap Silme Talebi
```

Bu bağlantı `privacy.html#hesap-silme` sayfasını açar. Kullanıcı oradan GitHub Issues
üzerinden talep açar. Talep işleme alındığında:

1. Kullanıcının kimliği/hesap sahipliği doğrulanır.
2. Firebase Authentication kullanıcısı silinir.
3. Firestore profili, cihaz bağlantıları ve push aboneliği silinir.
4. Güvenlik/denetim kayıtları gerekiyorsa anonimleştirilir veya yasal süre kadar tutulur.
5. Talebe en geç 30 gün içinde yanıt verilir.

Play Console'da **Account deletion** bölümüne aynı URL'yi girin. Otomatik silme
istenirse, ileride Firestore `deletion_requests` + Cloud Function akışı eklenebilir.

## 9. Yayın öncesi kontrol listesi

- [ ] Play Console'da uygulama oluşturuldu; paket adı doğru.
- [ ] `DeneyapEvKoruma-2.22.0-release.aab` internal testing'e yüklendi.
- [ ] Telefonda internal testing kurulumu; uygulama tam ekran WebView'de açılıyor.
- [ ] Yerel ⋮ menü, kısayollar, aşağı çekerek yenileme ve çift geri tuşu çalışıyor.
- [ ] Giriş, cihaz, telemetri, komut, bildirim, çevrimdışı testleri geçti.
- [ ] Gizlilik politikası URL'si canlı ve giriş gerektirmiyor.
- [ ] Hesap silme bağlantısı canlı ve uygulama içinden erişilebilir.
- [ ] Data safety formu dolduruldu.
- [ ] Content rating anketi dolduruldu.
- [ ] Target audience 18+ seçildi.
- [ ] App access için inceleme hesabı ve talimatlar girildi.
- [ ] En az 2 telefon ekran görüntüsü yüklendi.
- [ ] 512×512 ikon ve 1024×500 feature graphic yüklendi.
- [ ] Kısa/tam açıklama ve sürüm notu girildi.
- [ ] Geliştirici iletişim e-postası ve gizlilik iletişimi girildi.
- [ ] Ülke/bölge dağıtımı seçildi.
- [ ] Kademeli yayın planı belirlendi.
- [ ] Yedek: `android-keys` klasörü ve `KEYSTORE-INFO.txt` güvende.

## 10. Bilinen riskler / notlar

- **Cihaz testi yapılmadı:** Bu makinede bağlı telefon/emülatör yoktu. Yayın öncesi
  gerçek cihazda test zorunlu.
- **Mobil görünüm:** 2.22.0 ile beş sekmeli alt gezinme, mod şeridi, canlı kokpit ve
  güvenli alan desteği eklendi; 390×844, 800×1000 ve 1440×900 boyutlarında doğrulandı.
  Yine de gerçek telefonda klavye, çentik ve döndürme testi yapılmalı.
- **Minimum işlevsellik:** İnceleme sırasında cihaz yoksa panel “bağlantı yok” gösterebilir.
  Demo cihaz/veri hazırlamak inceleme riskini azaltır.
- **Chrome yolu:** Google ile giriş veya web push gerekirse ⋮ menüsünden “Chrome'da aç”
  kullanılabilir; bu yolda adres çubuğu görünür.
- **TWA'dan geçiş:** Önceki TWA sürümü bazı telefonlarda açılıp hemen kapanıyordu. Bu
  sürüm, uygulamanın her cihazda açılması için tam ekran WebView kabuğuna geçti.
- **Font/emoji:** Ekran görüntüleri Chrome'da alındı; farklı cihazlarda küçük farklar olur.
- **Yasal:** Gizlilik politikası ve veri sorumlusu bilgileri taslaktır; kendi bilgilerinizle
  gözden geçirin.

## 11. Faydalı komutlar

```powershell
npm run android:all          # APK + AAB
npm run android:aab          # sadece AAB
npm run android:install      # APK + bağlı cihaza kur
npm run android:icons        # ikonları yenile
npm run check                # sürüm/PRECACHE/HTML kontrolü
npm run build                # public/ (Vercel) çıktısı
```

```powershell
# İmza parmak izi
keytool -list -v -keystore "C:\Users\mabil\OneDrive\Desktop\dd uygulama\android-keys\deneyap-upload.jks" -alias deneyap
```
