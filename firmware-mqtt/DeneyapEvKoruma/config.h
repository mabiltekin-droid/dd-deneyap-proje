/*
 * config.h — Deneyap Ev Koruma Sistemi (MQTT sürümü)
 * ----------------------------------------------------------------------------
 * Tüm ağ, broker, pin ve eşik ayarları bu dosyada toplanmıştır.
 * main .ino dosyasına dokunmadan buradan kablolama ve eşikleri değiştirebilirsin.
 *
 * Bu firmware, depodaki `pwa/` kontrol paneliyle (varsayılan `transport: 'mqtt'`)
 * haberleşecek şekilde yazılmıştır. Panel şu konuları bekler (<T> = MQTT_TOPIC):
 *
 *    <T>/status    cihaz -> panel   durum JSON'u (retained)
 *    <T>/cmd       panel -> cihaz   {"id":7,"device":"fan","action":"on","value":0}
 *    <T>/settings  panel -> cihaz   {"gasWarn":250,...}
 *    <T>/online    cihaz -> panel   "online" / LWT ile "offline" (retained)
 *    <T>/histreq   panel -> cihaz   {"id":9,"n":140,"last":1440}
 *    <T>/hist      cihaz -> panel   {"id":9,"recs":[[t,ppm,rain,st,fl],...]}
 * ============================================================================
 */
#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

/* ============================ CİHAZ KİMLİĞİ ============================ */
/* Panelde her kartı ayırt eden kısa kimlik. Hesap eşleştirmesi bu değeri
   kullanır. Aynı MQTT_TOPIC'i kullanan iki kart olmasın! */
#define DEVICE_ID          "kart1"
#define FW_VERSION         "3.0.0"   // package.json / config.js / sw.js ile aynı tutulmalı

/* ============================ Wi-Fi (STA) ============================== */
/* Kart evdeki modem/telefon paylaşımına bağlanır; panel internet üzerinden
   MQTT ile ulaşır. Wi-Fi'ye bağlanamazsa cihaz kendi erişim noktasını (AP)
   açar (aşağıdaki AP_*) ve aynı yerel ağdan http://192.168.4.1 ile erişilir. */
#define WIFI_SSID          "EV_WIFI_ADI"      // <<< burayı doldur
#define WIFI_PASS          "EV_WIFI_SIFRESI"  // <<< burayı doldur
#define WIFI_CONNECT_MS    20000UL            // STA bağlantısı için en fazla bekleme

/* Wi-Fi STA başarısız olursa açılacak yedek erişim noktası */
#define AP_SSID            "DeneyapEvGuvenlik"
#define AP_PASSWORD        "12345678password" // WPA2 => en az 8 karakter
#define AP_CHANNEL         1
#define AP_MAX_CLIENTS     4
#define AP_HIDDEN          false

/* =============================== MQTT ================================= */
/* Panel varsayılanları: wss://broker.emqx.io:8084/mqtt
   Cihaz TCP ile aynı broker'a bağlanır => port 1883.
   (TLS istersen WiFiClientSecure + 8883 kullan; burada sade sürüm var.) */
#define MQTT_HOST          "broker.emqx.io"
#define MQTT_PORT          1883
#define MQTT_USER          ""            // broker kullanıcı adı (gerekmiyorsa boş)
#define MQTT_PASS          ""            // broker parolası (gerekmiyorsa boş)
#define MQTT_TOPIC         "deneyap/kart1"  // config.js içindeki mqttTopic ile AYNI olmalı
#define MQTT_STATUS_MS     3000UL        // durum yayın periyodu (panel 12 sn'de bayat sayar)
#define MQTT_BUFFER_SIZE   4608          // geçmiş yanıtı (140 kayıt) sığsın diye

/* ============================ TELEGRAM ================================ */
/* Token ve chat id kalıcı olarak NVS'ye kaydedilir (panel Ayarlar'dan girer).
   Aşağıdaki yalnızca ilk açılış için varsayılandır. */
#define TG_ENABLED_DEFAULT false

/* ============================ PIN HARİTASI ============================ */
/* Analog girişler ADC1 kanalında olmalı (Wi-Fi açıkken ADC2 kullanılamaz). */
#define PIN_MQ2            A0    // Deneyap Kart A0  - Gaz / duman sensörü
#define PIN_RAIN           A1    // Deneyap Kart A1  - Yağmur sensörü

/* Çıkışlar: transistörlü röle modülü / sürücü üzerinden.
   ESP32 strapping pinleri (GPIO0, 2, 5, 12, 15) ÇIKIŞ olarak kullanılmamalı. */
#define PIN_RELAY_FAN      13    // Fan (davlumbaz havalandırma)
#define PIN_RELAY_PUMP     27    // Su motoru / dalgıç pompa
#define PIN_BUZZER         33    // Buzzer (transistör sürücü ile)
#define PIN_SERVO_WINDOW   25    // Servo 1 - pencere kapağı
#define PIN_SERVO_BLIND    26    // Servo 2 - panjur
#define PIN_LED            -1    // Durum LED'i GPIO'su (kart üstü). Yoksa -1 bırak.

/* Servo açıları (derece) */
#define SERVO_WINDOW_OPEN  180
#define SERVO_WINDOW_SHUT  0
#define SERVO_WINDOW_AJAR  90
#define SERVO_BLIND_OPEN   180
#define SERVO_BLIND_SHUT   0

/* ======================= SENSÖR KALİBRASYONU =========================== */
/* MQ2 ham ADC değerini PPM'e çevirmek için doğrusal model:
     ppm = (filtre - temiz) * (GAS_PPM_FULL_SCALE / (ADC_FULL_SCALE - temiz))
   10-bit analog çözünürlük (0..1023) sabitlenir. */
#define ADC_FULL_SCALE     1023.0
#define GAS_CLEAN_SAMPLES  20            // açılışta temiz hava tabanı için örnek sayısı
#define GAS_BASE_MIN       20            // bu değerin altındaki "temiz" ölçümü şüpheli
#define GAS_PPM_FULL_SCALE 10000.0       // ADC doyduğunda varsayılan ppm
#define GAS_FAULT_LOW      3             // bu ham değerin altı = sensör kopuk/arıza
#define GAS_FAULT_HIGH     1020          // bu ham değerin üstü = sensör kısa devre

/* MQ2 ısınma süresi: bu süre dolmadan `ready=false` yayınlanır. */
#define GAS_WARMUP_MS      20000UL

/* Sensör gürültü filtreleme (Üstel Hareketli Ortalama - EMA) */
#define SENSOR_EMA_ALPHA   0.2f          // yeni ölçüm ağırlığı (0..1)

/* Yağmur sensörü: 10-bit (0..1023). Ham değer yükseldikçe "ıslak" varsayılır;
   sensör ters çalışıyorsa panelden rainInvert=true yapılır. */
#define RAIN_WET_PCT       50            // bu yüzden itibaren "ıslak"
#define RAIN_FLOOD_PCT     85            // bu yüzden itibaren "su baskını"
#define FLOOD_HOLD_MS      8000UL        // selin kalıcı sayılması için gereken süre

/* ============================ GÜVENLİK EŞİKLERİ ======================= */
#define GAS_WARN_PPM       250
#define GAS_DANGER_PPM     400
#define GAS_HYSTERESIS     60

/* Gaz normal seviyeye döndükten kaç ms sonra fan kendiliğinden kapansın */
#define FAN_AUTO_OFF_MS    120000UL      // 2 dakika
/* Su motorunun kesintisiz çalışabileceği azami süre (taşma koruması) */
#define PUMP_MAX_RUN_MS    300000UL      // 5 dakika

/* ============================ ZAMANLAMA =============================== */
#define SENSOR_INTERVAL_MS 200           // sensör okuma periyodu
#define SERIAL_REPORT_MS   2000          // seri monitör raporu
#define SERVO_MOVE_MS      800           // "hareket ediyor" göstergesi
#define HISTORY_STEP_MS    60000UL       // geçmiş örnek aralığı (60 sn => 24 sa = 1440)
#define HISTORY_MAX        1440          // 24 saatlik halka tampon

/* ======================= DOSYA SİSTEMİ (LittleFS) ===================== */
/* Bu sürüm PWA'yı cihazdan sunmaz (panel Vercel'de barınır); yalnızca durum
   JSON'undaki `fs` alanını beslemek için LittleFS varlığı bildirilir. */
#define FS_LABEL           "LittleFS"

/* HTTP kontrol ucu için paylaşılan anahtar (boş = koruma kapalı) */
#define API_TOKEN          ""

#endif // CONFIG_H
