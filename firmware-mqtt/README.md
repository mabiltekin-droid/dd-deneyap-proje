# Deneyap Ev Koruma — Cihaz Firmware'i (MQTT sürümü)

**Sürüm: 3.5.1** — Deneyap Kart 1A v2 pin eşlemesi, titreşim ve alev sensörü,
MAX98357A I2S alarm/siren/bip desteği. Bunlara ek olarak:
yedek broker'a otomatik geçiş, ısınma sonrası
gaz tabanı yeniden ölçümü + uyarlanabilir taban, panelden gaz tabanı
kalibrasyonu, yağmur sensörü ham ADC kalibrasyonu + **kopuk/kısa sensör
koruması**, üstel yeniden bağlanma.

Bu klasör, depodaki `pwa/` kontrol panelinin **varsayılan MQTT taşımasıyla**
(`transport: 'mqtt'`, birincil `wss://broker.emqx.io:8084/mqtt`, yedek
`wss://broker.hivemq.com:8884/mqtt`, konu `deneyap/kart1`) uyumlu
**Deneyap Kart / Arduino IDE** firmware'ini içerir.

> Neden yeni bir firmware? Depodaki mevcut `firmware/firmware.ino` yalnızca
> **HTTP + Access Point** tabanlıydı; panel ise MQTT bekliyordu (durumda
> `ready`, `rainPct`, `flood`, `gasHyst`, `cmdId`, `cmdErr`, `pumpLocked` …
> alanları ve `<T>/cmd`, `<T>/settings`, `<T>/histreq`, `<T>/hist`, `<T>/online`
> konuları). Bu firmware o sözleşmeyi birebir uygular.

## Dosyalar

| Dosya | Açıklama |
|-------|----------|
| `DeneyapEvKoruma/DeneyapEvKoruma.ino` | Ana sketch (Deneyap Kart IDE bu isimle açar) |
| `DeneyapEvKoruma/config.h` | Tüm ağ / broker / pin / eşik ayarları |

## Gerekli kütüphane

`Deneyap Kart IDE → Araçlar → Kütüphane Yöneticisi`:

- **PubSubClient** (Nick O'Leary)

Geri kalanı Deneyap Kart (ESP32-S3) çekirdeğiyle gelir:
`WiFi`, `WebServer`, `Preferences`, `HTTPClient`, `WiFiClientSecure` ve I2S.
MAX98357A amfisi I2S ile sürülür; ek ses kütüphanesi gerekmez.

> **Servo.h bu çekirdekte bulunmaz** — servo sürücüsü firmware içinde
> ESP32 yerleşik **LEDC** donanımıyla yapılır (ekstra kütüphane gerekmez).

## Kurulum adımları

1. `config.h` içinde şunları doldurun:
   - `WIFI_SSID`, `WIFI_PASS` → evinizin Wi-Fi ağı
   - `MQTT_HOST`, `MQTT_TOPIC` → panel ayarlarıyla **birebir aynı** olmalı
     (varsayılan: `broker.emqx.io` / `deneyap/kart1`). `MQTT_HOST_FALLBACK`
     (varsayılan `broker.hivemq.com`) birincil erişilemezse kullanılır;
     paneldeki **Yedek Yayıncı Adresi** (`mqttUrl2`) ile eşleşmelidir.
   - `DEVICE_ID` → boş bırakılabilir; boşsa kartın eFuse MAC'inden otomatik
     `DK-XXXX` kimliği üretilir (karta özel; panele hesap bağlamada bu kimliği kullanır).
2. `DeneyapEvKoruma/DeneyapEvKoruma.ino` dosyasını Deneyap Kart IDE ile açın.
3. Kart seçimi: **Deneyap Kart 1A v2**.
4. Yükleyin. Seri monitör (115200 baud) bağlantı durumunu gösterir.
5. Panelde `Ayarlar → Bağlantı` bölümünde taşıma = **MQTT**, broker ve konu
   alanlarını firmware ile aynı yapın.

## Bağlantı (pin haritası — `config.h`'den değiştirilebilir)

| İşlev | Deneyap Kart 1A v2 pini |
|-------|------------------------|
| MQ2 gaz / duman sensörü (AO) | `A0` |
| Yağmur sensörü (AO) | `A1` |
| Titreşim sensörü — dijital (DO) | `D0` |
| Titreşim sensörü — analog (AO, isteğe bağlı) | `A7` |
| Alev sensörü — dijital (DO) | `D1` |
| Fan rölesi sürücüsü IN | `D7` |
| Su motoru rölesi sürücüsü IN | `D8` |
| Servo — pencere sinyali | `D10` |
| Servo — panjur sinyali | `D11` |
| MAX98357A BCLK | `D6` |
| MAX98357A LRC / WS | `D5` |
| MAX98357A DIN | `D4` |

> Bu firmware **Deneyap Kart 1A v2** pin etiketlerini kullanır. D pin adları
> GPIO numaralarıyla karıştırılmamalıdır; kartta `D28` yoktur. MAX98357A'yı
> BCLK→D6, LRC/WS→D5, DIN→D4, 5V→5V ve GND→GND olacak şekilde bağlayın.
> Sensör girişlerine 3.3 V'tan yüksek gerilim vermeyin. Röle ve servolar için
> uygun harici güç kaynağı kullanıp GND'yi ortaklayın.
>
> **Titreşim sensörü (SW-420 / 801S sınıfı):** Hem dijital (DO) hem analog (AO)
> çıkış desteklenir; varsayılan olarak **yalnızca dijital** kullanılır (yaygın
> 3 pinli modül). DO, LM393 açık kolektör olduğundan dahili yukarı çekme açılır;
> sarsıntıda LOW'a çekilir. 4 pinli modülde panelden **analog** da açılabilir
> (yavaş tabana göre sapma ile tetiklenir).

> Röle/buzzer beslemesini kartın 3V3/5V'undan ayrı bir kaynaktan vermeniz ve
> ortak GND kullanmanız önerilir. ESP32 GPIO'ları 5 V toleranslı **değildir**.

## MQTT konu (topic) şeması

`<T>` = `MQTT_TOPIC` (örn. `deneyap/kart1`)

| Konu | Yön | İçerik |
|------|-----|--------|
| `<T>/status` | cihaz → panel | durum JSON (retained, 3 sn'de bir) |
| `<T>/cmd` | panel → cihaz | `{"id":7,"device":"fan","action":"on","value":0}` |
| `<T>/settings` | panel → cihaz | `{"gasWarn":250,"gasDanger":400,...}` |
| `<T>/online` | cihaz → panel | `online` (LWT ile `offline`) |
| `<T>/histreq` | panel → cihaz | `{"id":9,"n":140,"last":1440}` |
| `<T>/hist` | cihaz → panel | `{"id":9,"recs":[[t,ppm,rain,st,fl],...]}` |

Komutlar:
- `fan` / `pump` / `auto` → `on` | `off` | `toggle`
- `buzzer` / `sound` / `speaker` → `on` | `off` | `toggle` (sesli alarm mandalı),
  `test` (test tonu), `siren`, `beep`, `set`/`volume` (`value` = 0..100 ses seviyesi)
- `vibration` / `vib` → `on` | `off` | `toggle` (algılama), `alarm` | `noalarm`
  (sarsıntıda tam alarm), `test` (alarmı simüle et), `clear` (olayı temizle)
- `flame` / `fire` → `on` | `off` | `toggle` (algılama), `alarm` | `noalarm`
  (alevde tam alarm), `test` (alarmı simüle et), `clear` (olayı temizle)
- `window` / `blind` → `open` | `shut` | `ajar` | `set` | `angle` | `stop`
- `gas` → `recalibrate` (temiz hava tabanını yeniden ölç)
- `test` → `simulate_alarm` (5 sn'lik gaz tehlikesi); `reboot`

## Notlar

- Wi-Fi'ye bağlanamazsa cihaz `DeneyapEvGuvenlik` adlı kendi AP'sini açar
  (`http://192.168.4.1`); bu durumda internet olmadığı için MQTT çalışmaz,
  yalnızca HTTP API erişilebilir.
- `broker.emqx.io` herkese açık bir test broker'ıdır. Konu adınızı kimsenin
  tahmin edemeyeceği bir değere (örn. `deneyap/ev-3f9a2`) çevirmeniz önerilir.
- **Broker yedekleme:** Herkese açık broker'lar zaman zaman ağ engellemesi /
  aksaklık yaşar (kart "durum=-4/-2" döngüsüne girer, panel `emqx`e bağlanamaz).
  Firmware birincile üst üste `MQTT_FAILOVER_AFTER` (3) kez bağlanamazsa
  `MQTT_HOST_FALLBACK`e geçer ve birincil düzelince (5 dk'da bir yoklama)
  kendiliğinden ona döner. Yedeğe geçer geçmez yeniden bağlanma beklemesi
  3 sn'ye sıfırlanır (hızlı devralma). Panel de aynı sırayı
  (`mqttUrl` → `mqttUrl2`) izler, böylece kart ve panel hep aynı yayıncıda
  buluşur. Yeniden bağlanma beklemesi 3 sn'den başlar ve 60 sn'ye kadar üstel
  artar (broker'ı boğmamak için).
- **Gaz tabanı:** Açılışta MQ-2 soğukken ölçülen taban kısa süre 1023'e yakın
  olabilir; bu, `ppm` hesabını bozar. Firmware, `GAS_WARMUP_MS` (180 sn) ısınma
  penceresi bitince tabanı **bir kez daha** ölçer; `ready` alanı bu ölçüm
  tamamlanana kadar `false` kalır. MQ-2 **3.3 V** ile beslenirken ısıtıcı zayıf
  kaldığından taban geç oturur (sahada ~60 sn'de 90, ~90 sn'de 176, ~180 sn'de
  oturmuş) — bu yüzden pencere 180 sn'dir. Taban 900'ün üzerindeyse (modül
  raylanmış / sensör yok) güvenli varsayılana (200) dönülür. Isınma sonrası
  **uyarlanabilir taban** devreye girer: temiz hava varsayımıyla (`ppm` uyarı
  eşiğinin altında) taban çok yavaş (%1) okumaya çekilir; gaz şüphesi varsa
  donar (gerçek gazı yutup alarmı maskelemez). Panelden "Gaz Sensörü Tabanını
  Yeniden Kalibre Et" komutu (`device:"gas", action:"recalibrate"`) tabanı o an
  yeniden ölçer. Temiz hava tabanının altındaki okumalar negatif ppm üretir;
  alarm eşikleri pozitif olduğundan uyarı tetiklemez.
- **Yağmur sensörü kalibrasyonu:** Bu modülün çıkışı **ters** — kuru havada ham
  ADC tepeye yakın (~1023), suya değince düşer (tam ıslak ~520). Firmware ham
  değeri `RAIN_DRY_ADC` (1023, kuru) .. `RAIN_WET_ADC` (500, ıslak) aralığında
  %0..%100 ıslaklığa ölçekler. Farklı/ters tip bir modülde panelden
  `rainInvert=true` yapılır (çıkan yüzde ters çevrilir). Eşikler: `rainWetPct`
  (50) üstü "ıslak", `rainFloodPct` (85) üstü `FLOOD_HOLD_MS` (8 sn) boyunca
  kalırsa "su baskını".
  **Arıza/kopuk koruması:** Ters tip modülde ham değerin mantıklı tabanı ~500'dür
  (tam ıslak). Ham değer `RAIN_FAULT_LOW` (40) altına düşerse (kablo çıkmış / AO
  toprağa kısa) sensör **bozuk/kopuk** sayılır; durumda `rainOk=false` yayınlanır
  ve **yanlış "su baskını" üretilmez** (pencere kapanmaz, siren çalmaz). Panelde
  yağmur kartı "SENSÖR YOK / KOPUK" gösterir. `rainInvert=true` iken (karşı tip
  modül) bu koruma uygulanmaz, çünkü orada düşük ham değer normaldir (kuru).
- **Titreşim / sarsıntı (v3.1.0):** SW-420 / 801S sınıfı modül. Varsayılan olarak
  **dijital** giriş kullanılır; sarsıntıda olay `VIB_TRIGGER_HOLD_MS` (4 sn)
  boyunca "aktif" kalır. `vibAlarm` açıkken sarsıntı **tam alarmı** tetikler:
  siren çalar, pencere kapanır, su motoru kilitlenir ve (`vibTg` ise) Telegram
  bildirimi gider. Panelden algılama aç/kapa, tam alarm aç/kapa ve "Alarmı
  Simüle Et" (`vibration` → `test`) yapılabilir. Durumda `vib`, `vibRaw`,
  `vibBase`, `vibDigital`, `vibEnabled`, `vibAlarm`, `vibDetected`,
  `vibUseDigital`, `vibUseAnalog`, `vibTg` alanları yayınlanır.
- **Alev / yangın (v3.2.0):** IR alev sensörü modülü (ör. **KY-026**, LM393
  tabanlı). Titreşimle aynı mantık: hem dijital (DO) hem analog (AO)
  desteklenir, varsayılan **yalnızca dijital** kullanılır. DO, LM393 açık
  kolektör olduğundan dahili yukarı çekme açılır; alev algılanınca LOW'a
  çekilir. Alev olayı **en yüksek öncelikli** alarmdır (gazdan da önce):
  `flameAlarm` açıkken siren çalar, pencere **kapatılır** (oksijen kesilir),
  **fan ve su motoru durdurulur** (yangına oksijen/hava verilmez) ve (`flameTg`
  ise) Telegram bildirimi gider. Panelden algılama aç/kapa, tam alarm aç/kapa
  ve "Alarmı Simüle Et" (`flame` → `test`) yapılabilir. Durumda `flame`,
  `flameRaw`, `flameBase`, `flameDigital`, `flameEnabled`, `flameAlarm`,
  `flameDetected`, `flameUseDigital`, `flameUseAnalog`, `flameTg` alanları
  yayınlanır; geçmiş kaydında 256 biti (`fl`) alev olayını işaretler.
  > **Kablolama:** Dijital çıkışı **D1**'e bağlayın. Bu firmware'de analog
  > alev girişi kapalıdır; kullanmak için `PIN_FLAME_AO` atamasını değiştirin. Gerekirse `config.h`'de
  > `PIN_FLAME_DO` / `PIN_FLAME_AO` değerlerini değiştirin. Modülü 3V3 ile
  > besleyin (GPIO'lar 5 V toleranslı değildir).
- **Ses / hoparlör (I2S):** MAX98357A amfi ile sesli alarm. Desenler:
  `siren` (alarm), `alarm` (kesintili), `test` (test tonu), `bip`. Panelden ses
  seviyesi (`sndVolume`, 0..100) ve siren/bip testi yapılabilir; seviye NVS'ye
  kaydedilir. Durumda `sndMode` (`kapali`/`alarm`/`siren`/`test`/`bip`), `sndVol`,
  `sndManual`, `sndReady` alanları yayınlanır. **AI sesli anons** cihazda değil,
  panel (telefon) tarafındaki konuşma senteziyle (Web Speech API) yapılır.
- Geçmiş: RAM'de 24 saatlik halka tampon (60 sn'de 1 örnek) tutulur; kart
  yeniden başlarsa sıfırlanır (panel yerel önbelleğiyle tamamlar).
- Telegram: panel `Ayarlar → Telegram` bölümünden bot token + chat id girilir;
  firmware bunları NVS'ye kaydeder ve gaz tehlikesi/su baskınında bildirim yollar.
- **Web Push (v3.2.2, isteğe bağlı):** Panel kapalıyken de bildirim için
  `config.h` içindeki `PUSH_URL` (Vercel `api/push.js`) ve `PUSH_SECRET`
  doldurulur. Cihaz; alev, gaz tehlikesi, su baskını ve sarsıntı anında
  göndericiye kısa bir HTTPS isteği atar (aynı türden 30 sn'de bir); gönderici
  `push_subs` koleksiyonundaki aboneliklere bildirimi iletir. Boş bırakılırsa
  özellik kapalıdır ve Telegram yine çalışır. Kurulum: `FIREBASE.md` §6.
- **Güç / brownout:** Wi-Fi TX ani akımı, marjinal USB beslemelerde voltajı
  düşürüp sistemin sürekli resetlenmesine yol açabilir. Firmware bu duruma karşı
  (a) açılışta brownout detektörünü kapatır, (b) Wi-Fi TX gücünü 8.5 dBm'e
  indirir. Yine de kartın doğrudan (hub üzerinden değil) yeterli güçlü bir USB
  portuna, kısa/kaliteli kabloyla bağlanması önerilir.
- **MQ-2 beslemesi:** MQ-2 modülünü **3V3** ile besleyin (VCC→3V3, GND→GND,
  AO→A0; DO boş). 5V ile beslemek (a) ısıtıcının ≈150-180 mA çekişiyle brownout
  resetine yol açar, (b) AO çıkışının ESP32 GPIO (3.3 V) sınırını aşmasına neden
  olabilir. 3.3 V'da modül temiz havada ~150-350 ham ADC okur.
