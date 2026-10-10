# Deneyap Ev Koruma — Cihaz Firmware'i (MQTT sürümü)

Bu klasör, depodaki `pwa/` kontrol panelinin **varsayılan MQTT taşımasıyla**
(`transport: 'mqtt'`, `wss://broker.emqx.io:8084/mqtt`, konu `deneyap/kart1`)
uyumlu **Deneyap Kart / Arduino IDE** firmware'ini içerir.

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
`WiFi`, `WebServer`, `Servo`, `Preferences`, `HTTPClient`, `WiFiClientSecure`.

## Kurulum adımları

1. `config.h` içinde şunları doldurun:
   - `WIFI_SSID`, `WIFI_PASS` → evinizin Wi-Fi ağı
   - `MQTT_HOST`, `MQTT_TOPIC` → panel ayarlarıyla **birebir aynı** olmalı
     (varsayılan: `broker.emqx.io` / `deneyap/kart1`)
   - `DEVICE_ID` → kartın kısa kimliği (örn. `kart1`)
2. `DeneyapEvKoruma/DeneyapEvKoruma.ino` dosyasını Deneyap Kart IDE ile açın.
3. Kart seçimi: **Deneyap Kart** (veya kullandığınız model).
4. Yükleyin. Seri monitör (115200 baud) bağlantı durumunu gösterir.
5. Panelde `Ayarlar → Bağlantı` bölümünde taşıma = **MQTT**, broker ve konu
   alanlarını firmware ile aynı yapın.

## Bağlantı (pin haritası — `config.h`'den değiştirilebilir)

| İşlev | Deneyap Kart pini | GPIO |
|-------|-------------------|------|
| MQ2 gaz / duman sensörü (AO) | A0 | 36 |
| Yağmur sensörü (AO) | A1 | 39 |
| Fan rölesi | D (13) | 13 |
| Su motoru rölesi | D (27) | 27 |
| Buzzer (transistör sürücü) | D (33) | 33 |
| Servo — pencere | D (25) | 25 |
| Servo — panjur | D (26) | 26 |

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

Komutlar: `fan`/`pump`/`buzzer` → `on|off|toggle`; `window`/`blind` →
`open|shut|ajar|set|angle|stop`; `auto` → `on|off|toggle`; `test` →
`simulate_alarm`; `reboot`.

## Notlar

- Wi-Fi'ye bağlanamazsa cihaz `DeneyapEvGuvenlik` adlı kendi AP'sini açar
  (`http://192.168.4.1`); bu durumda internet olmadığı için MQTT çalışmaz,
  yalnızca HTTP API erişilebilir.
- `broker.emqx.io` herkese açık bir test broker'ıdır. Konu adınızı kimsenin
  tahmin edemeyeceği bir değere (örn. `deneyap/ev-3f9a2`) çevirmeniz önerilir.
- Geçmiş: RAM'de 24 saatlik halka tampon (60 sn'de 1 örnek) tutulur; kart
  yeniden başlarsa sıfırlanır (panel yerel önbelleğiyle tamamlar).
- Telegram: panel `Ayarlar → Telegram` bölümünden bot token + chat id girilir;
  firmware bunları NVS'ye kaydeder ve gaz tehlikesi/su baskınında bildirim yollar.
