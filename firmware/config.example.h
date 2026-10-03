/*
 * config.example.h — config.h'in ŞABLONUDUR, DOĞRUDAN DERLENMEZ.
 *
 * İlk kurulum (veya yeni bir bilgisayara geçerken):
 *
 *     copy firmware\config.example.h firmware\config.h
 *
 * Sonra config.h içindeki AP_PASSWORD / API_TOKEN değerlerini kendi
 * cihazına göre düzenle. config.h .gitignore'dadır, yani şifren
 * asla depoya girmez.
 *
 * Donanım ve eşik ayarlarının tamamı bu dosyada; main.ino'ya dokunma.
 */
#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

/* ============================ AĞ (AP MODU) ============================ */
/* Cihaz kendi erişim noktasını (hotspot) açar, telefon ona bağlanır.
   Cihazın adresi varsayılan olarak http://192.168.4.1 olur. */
#define AP_SSID            "DeneyapEvGuvenlik"
#define AP_PASSWORD        "BURAYA-KENDI-SIFRENI-YAZ"  // WPA2 >= 8 karakter
#define AP_CHANNEL         1
#define AP_MAX_CLIENTS     4
#define AP_HIDDEN          false

/* /api/control ucunu korumak için token. Boş bırakırsan koruma kapalı olur.
   Örnek: "gizli-anahtar" -> PWA'da Ayarlar > Cihaz Token alanına aynısını yaz. */
#define API_TOKEN          ""

#define FW_VERSION         "2.3.0"

/* ============================ PIN HARİTASI ============================= */
/* Analog girişler ADC1 kanalında olmalı (Wi-Fi açıkken ADC2 kullanılamaz). */
#define PIN_MQ2            A0    // GPIO36 - ADC1_CH0 - Gaz / duman sensörü
#define PIN_RAIN           A1    // GPIO39 - ADC1_CH1 - Yağmur sensörü

/* Çıkışlar: sadece sürülebilir pinler (transistör röle modülü üzerinden) */
#define PIN_RELAY_FAN      13    // Fan (davlumbaz havalandırma)
#define PIN_RELAY_PUMP     27    // Su motoru / dalgıç pompa
#define PIN_BUZZER         33    // Buzzer (transistör sürücü ile)
#define PIN_SERVO_WINDOW   25    // Servo 1 - pencere kapağı
#define PIN_SERVO_BLIND    26    // Servo 2 - panjur

/* Eski (riskli) eşleşme, referans için:
   #define PIN_RELAY_FAN    D0    // GPIO0  -> strapping, açılışta LOW olmalı
   #define PIN_RELAY_PUMP   D1    // GPIO1  -> UART TX, açılışta LOW olmalı
   #define PIN_FAN_LEGACY   D2    // GPIO2  -> strapping, açılışta LOW olmalı
*/

/* Servo açıları (derece). Actuator'lar sürekli döndüğü için "stop"
   komutu servo'yu ayırır (motoru sürüklemez). */
#define SERVO_WINDOW_OPEN  180
#define SERVO_WINDOW_SHUT  0
#define SERVO_WINDOW_AJAR  90
#define SERVO_BLIND_OPEN   180
#define SERVO_BLIND_SHUT   0

/* ======================= SENSÖR KALİBRASYONU =========================== */
/* MQ2 ham ADC değerini PPM'e çevirmek için doğrusal model:
     ppm = (raw - temiz) * (PPM_FS / (ADC_FS - temiz))
   `temiz` değeri açılışta temiz havadan örneklenir (MQ2_BASE_SAMPLES adet).
   Gerçek ölçüm hassasiyeti için eğri kalibrasyonu gerekir; bu makul bir
   başlangıç noktasıdır. */
#define ADC_FULL_SCALE     1023.0
#define GAS_CLEAN_SAMPLES  20          // açılışta alınacak örnek sayısı
#define GAS_BASE_MIN       60          // bu değerin altındaki "temiz" ölçümü şüpheli
#define GAS_PPM_FULL_SCALE 10000.0     // ADC doymasında kaç ppm varsayılsın

/* Yağmur sensörü: analog modülün çoğu kuru=LOW, ıslak=HIGH verir.
   Farklı modüllerde tersi olabilir -> PWA ayarlarından da çevrilebilir. */
#define RAIN_WET_ABOVE_RAW 2000        // bu eşiği aşıyorsa "ıslak" (varsayılan mantık)

/* ============================ GÜVENLİK EŞİKLERİ ======================= */
/* Histerezis: eşik aşılınca uyarıya girer, eşik-histerezis'in altına inince çıkar.
   Bu olmadan sensör eşiğin çevresinde salınır ve buzzer sürekli öter. */
#define GAS_WARN_PPM       250
#define GAS_DANGER_PPM     400
#define GAS_HYSTERESIS     60

/* Gaz normal seviyeye döndükten kaç ms sonra fan kendiliğinden kapansın */
#define FAN_AUTO_OFF_MS     120000UL   // 2 dakika
/* Su motorunun kesintisiz çalışabileceği azami süre (taşma koruması) */
#define PUMP_MAX_RUN_MS     300000UL   // 5 dakika

/* ============================ ZAMANLAMA =============================== */
#define SENSOR_INTERVAL_MS   200       // sensör okuma periyodu
#define SERIAL_REPORT_MS     2000      // seri monitör raporu
#define HTTP_TIMEOUT_MS      6000      // WebServer istek zaman aşımı
#define SERVO_MOVE_MS        800       // "hareket ediyor" göstergesi için
#define STATUS_JSON_MAX      640       // JSON yanıt tamponu

/* ======================= DOSYA SİSTEMİ (LittleFS) ===================== */
/* PWA dosyaları cihaza yüklenmeli: index.html, settings.html, css/, js/,
   manifest.json, icons/. Yüklenmezse firmware API-only modda çalışır ve
   kullanıcıyı bilgilendiren bir sayfa gösterir. */
#define FS_LABEL            "LittleFS"
#define WEB_ROOT            "/"

#endif // CONFIG_H
