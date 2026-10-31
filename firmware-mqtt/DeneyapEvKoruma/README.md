# Deneyap Ev Koruma — MQTT Firmware v3.4.0

Aktif kart yazılımı. Panel varsayılan olarak MQTT taşımasını kullanır; kart ayrıca
aynı yerel ağda HTTP JSON API sunar.

## v3.4.0 yenilikleri

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

## Gerekli

- Arduino IDE / arduino-cli
- ESP32 Arduino core (test: **3.3.10**)
- `PubSubClient` **2.8**
- Deneyap Kart 1A v2 FQBN: `esp32:esp32:deneyapkart1Av2`

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
