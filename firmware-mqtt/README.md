# Deneyap Ev Koruma — Cihaz Firmware'i (MQTT sürümü)

**Sürüm: 3.1.0** — titreşim/sarsıntı sensörü (dijital + analog) ve **I2S
hoparlör (MAX98357A)** desteği: sesli alarm/siren/bip, panelden ses seviyesi
ve siren testi. Bunlara ek olarak: yedek broker'a otomatik geçiş, ısınma sonrası
gaz tabanı yeniden ölçümü + uyarlanabilir taban, panelden gaz tabanı
kalibrasyonu, yağmur sensörü ham ADC kalibrasyonu + **kopuk/kısa sensör
koruması**, üstel yeniden bağlanma.

Bu klasör, depodaki `pwa/` kontrol panelinin **varsayılan MQTT taşımasıyla**
(`transport: 'mqtt'`, birincil `wss://broker.emqx.io:8084/mqtt`, yedek
`wss://broker.hivemq.com:8884/mqtt`, konu `deneyap/kart1`) uyumlu
**Deneyap Kart / Arduino IDE** firmware'ini içerir.

> Neden yeni bir firmware? Depodaki mevcut `firmware/main.ino` yalnızca
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

Geri kalanı Deneyap Kart (ESP32) çekirdeğiyle gelir:
`WiFi`, `WebServer`, `Preferences`, `HTTPClient`, `WiFiClientSecure` ve
**I2S sürücüsü** (`driver/i2s.h`). Sesli alarm için **ek kütüphane gerekmez**;
MAX98357A amfi doğrudan ESP32 donanımsal I2S'iyle sürülür.

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
3. Kart seçimi: **Deneyap Kart** (veya kullandığınız model).
4. Yükleyin. Seri monitör (115200 baud) bağlantı durumunu gösterir.
5. Panelde `Ayarlar → Bağlantı` bölümünde taşıma = **MQTT**, broker ve konu
   alanlarını firmware ile aynı yapın.

## Bağlantı (pin haritası — `config.h`'den değiştirilebilir)

| İşlev | Deneyap Kart pini | GPIO |
|-------|-------------------|------|
| MQ2 gaz / duman sensörü (AO) | A5 | 33 |
| Yağmur sensörü (AO) | A1 | 39 |
| Titreşim sensörü — dijital (DO) | D14 | 14 |
| Titreşim sensörü — analog (AO) | A4 | 32 |
| I2S amfi — BCLK | D6 | 18 |
| I2S amfi — LRC / WS | D5 | 19 |
| I2S amfi — DIN (veri) | D4 | 21 |
| Fan rölesi | D13 | 13 |
| Su motoru rölesi | D27 | 27 |
| Buzzer (transistör sürücü) | — | — (kapalı; ses I2S'ten) |
| Servo — pencere | D25 | 25 |
| Servo — panjur | D26 | 26 |

> **Pin değişikliği (v3.1.0):** Eski sürümde buzzer **GPIO33**'teydi; ama Deneyap
> 1A'da **A5 = GPIO33** ve MQ-2 gaz sensörü de A5'te olduğundan **çakışıyordu**
> (buzzer açılınca gaz okuması bozuluyordu). Sesli alarm artık **I2S
> hoparlörden** (MAX98357A) verilir; `PIN_BUZZER = -1` yapıldı. Ayrı bir piezo
> isterseniz `config.h` içinde boş bir GPIO (ör. `22`) yazıp buzzeri oraya bağlayın.
>
> **I2S amfi (MAX98357A):** 5 V ile beslenir, çıkışı hoparlöre gider. `SD`
> (shutdown/kazanç) pini bağlanmazsa amfi açık kalır (`PIN_I2S_SD = -1` yeterli).
> Besleme marjinalse (USB) 5 V hattına 470–1000 µF kondansatör önerilir.
> Hoparlör hattı ile besleme kablolarını ayrı tutun (parazit).
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
- **Ses / hoparlör (I2S, v3.1.0):** MAX98357A amfi ile sesli alarm. Desenler:
  `siren` (alarm), `alarm` (kesintili), `test` (test tonu), `bip`. Panelden ses
  seviyesi (`sndVolume`, 0..100) ve siren/bip testi yapılabilir; seviye NVS'ye
  kaydedilir. Durumda `sndMode` (`kapali`/`alarm`/`siren`/`test`/`bip`), `sndVol`,
  `sndManual`, `sndReady` alanları yayınlanır. **AI sesli anons** cihazda değil,
  panel (telefon) tarafındaki konuşma senteziyle (Web Speech API) yapılır.
- Geçmiş: RAM'de 24 saatlik halka tampon (60 sn'de 1 örnek) tutulur; kart
  yeniden başlarsa sıfırlanır (panel yerel önbelleğiyle tamamlar).
- Telegram: panel `Ayarlar → Telegram` bölümünden bot token + chat id girilir;
  firmware bunları NVS'ye kaydeder ve gaz tehlikesi/su baskınında bildirim yollar.
- **Güç / brownout:** Wi-Fi TX ani akımı, marjinal USB beslemelerde voltajı
  düşürüp sistemin sürekli resetlenmesine yol açabilir. Firmware bu duruma karşı
  (a) açılışta brownout detektörünü kapatır, (b) Wi-Fi TX gücünü 8.5 dBm'e
  indirir. Yine de kartın doğrudan (hub üzerinden değil) yeterli güçlü bir USB
  portuna, kısa/kaliteli kabloyla bağlanması önerilir.
- **MQ-2 beslemesi:** MQ-2 modülünü **3V3** ile besleyin (VCC→3V3, GND→GND,
  AO→A0; DO boş). 5V ile beslemek (a) ısıtıcının ≈150-180 mA çekişiyle brownout
  resetine yol açar, (b) AO çıkışının ESP32 GPIO (3.3 V) sınırını aşmasına neden
  olabilir. 3.3 V'da modül temiz havada ~150-350 ham ADC okur.
