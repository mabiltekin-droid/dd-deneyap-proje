# Deneyap Ev Koruma — MQTT Firmware v3.5.1

Aktif kart yazılımı. Panel varsayılan olarak MQTT taşımasını kullanır; kart ayrıca
aynı yerel ağda HTTP JSON API sunar.

## v3.5.1 yenilikleri

- ESP32 Arduino core **3.3.x** ile derlenir; core 2.x LEDC servo yolu korunur.
- `config.local.h` desteği: Wi-Fi, `PUSH_SECRET` ve OTA şifresi depoya yazılmadan
  yerel olarak tutulabilir. `config.local.example.h` örnektir.
- `/api/status` ve MQTT `status` JSON'una yeni alanlar:
  `board`, `core`, `push`, `pushUrlSet`, `pushSecretSet`, `pushCode`, `pushOk`,
  `pushAge`.
- `PUSH_URL` varsayılanı `https://ddproje.vercel.app/api/push`.
- Push isteğine `fw` alanı eklendi; hata durumunda HTTP kodu ve kısa yanıt
  seri porta yazılır.
- Açılışta kart/core ve push yapılandırması seri porta raporlanır.
- Deneyap Kart 1A v2 için A/D pin adlarıyla doğrulanmış pin haritası.
- MAX98357A I2S amfi için alarm/siren/bip çıkışı.

## Gerekli

- Arduino IDE / arduino-cli
- ESP32 Arduino core (test: **3.3.10**)
- `PubSubClient` **2.8**
- Deneyap Kart 1A v2 FQBN: `esp32:esp32:deneyapkart1Av2`

## Donanım pinleri (Deneyap Kart 1A v2)

| İşlev | Kart üzerindeki pin | Bağlantı |
|---|---|---|
| MQ-2 gaz sensörü AO | `A0` | Analog çıkış |
| Yağmur sensörü AO | `A1` | Analog çıkış |
| SW-420 / 801S DO | `D0` | Dijital çıkış, varsayılan aktif LOW |
| SW-420 / 801S AO | `A7` | İsteğe bağlı; analog modu varsayılan kapalı |
| IR alev sensörü DO | `D1` | Dijital çıkış, varsayılan aktif LOW |
| Fan röle sürücüsü IN | `D7` | Röle sürücüsü, aktif HIGH |
| Pompa röle sürücüsü IN | `D8` | Röle sürücüsü, aktif HIGH |
| Pencere servosu sinyal | `D10` | PWM |
| Panjur servosu sinyal | `D11` | PWM |
| MAX98357A BCLK | `D6` | I2S bit clock |
| MAX98357A LRC / WS | `D5` | I2S word select |
| MAX98357A DIN | `D4` | I2S data |

MAX98357A için BCLK/WS/DIN sinyallerini tabloda belirtilen pinlere, 5V ve GND'yi
uygun güç hatlarına bağlayın. Pin adları kart üzerindeki etiketlerdir; `GPIO 28`
gibi başka ESP32 kartlarına ait sayılar kullanılmaz. Deneyap Kart 1A v2'de D28
yoktur. Sensör girişlerine 3.3 V'tan yüksek sinyal uygulamayın. Röle ve servoları
kart GPIO'sundan beslemeyin; uygun harici güç ve ortak GND kullanın.

## Derleme ve yükleme

```powershell
npm run fw:mqtt
npm run fw:ota -- 192.168.1.50
```

USB ile yüklemek için:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-firmware.ps1 -Target mqtt -Upload -Port COM5
```

## Gizli ayarlar

`config.h` içindeki Wi-Fi ve push ayarları örnek/placeholder değerlerdir.
Gerçek değerler için bu klasöre `config.local.h` oluşturun:

```cpp
#undef WIFI_SSID
#define WIFI_SSID "ev-wifi"
#undef WIFI_PASS
#define WIFI_PASS "wifi-sifresi"

#undef PUSH_SECRET
#define PUSH_SECRET "vercel-push-trigger-secret"
```

`config.local.h` `.gitignore` içindedir. Şablon: `config.local.example.h`.

## Push durumu

`/status` yanıtında:

- `push: true` → `PUSH_URL` ve `PUSH_SECRET` dolu.
- `pushUrlSet` / `pushSecretSet` → hangi alanın eksik olduğunu gösterir.
- `pushCode` → son HTTPS isteğinin HTTP kodu (`0` = henüz denenmedi).
- `pushOk` → son istek başarılı mı.
- `pushAge` → son denemeden bu yana geçen saniye.

Gerçek alarmda uzak bildirimin doğru hesaba gitmesi için cihazın panelde kodla
bağlanmış olması (`device_bindings`) gerekir.
