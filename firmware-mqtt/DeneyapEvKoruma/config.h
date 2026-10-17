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
/* Panelde her kartı ayırt eden kimlik; hesap eşleştirmesi (device_bindings)
   bu değeri kullanır. Boş = eFuse MAC'ten otomatik "DK-XXXX" üretilir
   (karta özel, yeniden flaşta değişmez). Aynı MQTT_TOPIC'i kullanan iki
   kart olmasın! */
#define DEVICE_ID          ""        // boş = otomatik "DK-XXXX"; istersen sabit ad yaz (örn. "kart1")
#define FW_VERSION         "3.2.0"   // cihazın kendi sürümü; panel /status'te `fw` olarak gösterir
                                     // 3.1.0: titreşim sensörü + I2S hoparlör (MAX98357A) + sesli alarm
                                     // 3.2.0: alev (IR flame) sensörü — dijital + analog, tam alarm
                                     // (not: panel sürümü package.json/config.js/sw.js'ten ayrıdır)

/* ============================ Wi-Fi (STA) ============================== */
/* Kart evdeki modem/telefon paylaşımına bağlanır; panel internet üzerinden
   MQTT ile ulaşır. Wi-Fi'ye bağlanamazsa cihaz kendi erişim noktasını (AP)
   açar (aşağıdaki AP_*) ve aynı yerel ağdan http://192.168.4.1 ile erişilir. */
/* Ev Wi-Fi'si (yalnızca ÇALIŞAN kopyada dolu; repo public olduğundan
   placeholder ile commit'lenir). */
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
/* BİRİNCİL + YEDEK BROKER: Herkese açık broker'lar (broker.emqx.io dahil)
   zaman zaman ağ engellemesi / servis aksaklığı yaşar (kartın "durum=-4 / -2"
   döngüsüne girmesi gibi). Firmware, MQTT_HOST'a üst üste MQTT_FAILOVER_AFTER
   kez bağlanamazsa MQTT_HOST_FALLBACK'e geçer; birincil düzelince de (yedekte
   bağlıyken MQTT_PRIMARY_PROBE_MS'te bir yoklama) kendiliğinden ona döner.
   Panel tarafıyla uyum için: pwa/config.js'te mqttUrl (birincil) ve mqttUrl2
   (yedek) AYNI broker'lara işaret etmeli — panelle kart hep aynı broker'da
   buluşur. Panel varsayılanları: wss://broker.emqx.io:8084/mqtt,
   yedek wss://broker.hivemq.com:8884/mqtt. Cihaz TCP ile bağlanır => 1883. */
#define MQTT_HOST            "broker.emqx.io"
#define MQTT_PORT            1883
#define MQTT_HOST_FALLBACK   "broker.hivemq.com"
#define MQTT_PORT_FALLBACK   1883
#define MQTT_FAILOVER_AFTER  3          // üst üste başarısız deneme -> yedeğe geç
#define MQTT_RETRY_MIN       3000UL     // yeniden bağlanma aralığı başlangıcı (üstel geri çekilme)
#define MQTT_RETRY_MAX       60000UL    // üstel geri çekilmenin tavanı
#define MQTT_PRIMARY_PROBE_MS 300000UL  // yedekteyken birincili yoklama aralığı (5 dk)
#define MQTT_USER            ""         // broker kullanıcı adı (gerekmiyorsa boş)
#define MQTT_PASS            ""         // broker parolası (gerekmiyorsa boş)
#define MQTT_TOPIC         "deneyap/kart1"  // config.js içindeki mqttTopic ile AYNI olmalı
#define MQTT_STATUS_MS     3000UL        // durum yayın periyodu (panel 12 sn'de bayat sayar)
#define MQTT_BUFFER_SIZE   4608          // geçmiş yanıtı (140 kayıt) sığsın diye

/* ============================ TELEGRAM ================================ */
/* Token ve chat id kalıcı olarak NVS'ye kaydedilir (panel Ayarlar'dan girer).
   Aşağıdaki yalnızca ilk açılış için varsayılandır. */
#define TG_ENABLED_DEFAULT false

/* ============================ PIN HARİTASI ============================ */
/* Analog girişler ADC1 kanalında olmalı (Wi-Fi açıkken ADC2 kullanılamaz). */
#define PIN_MQ2            A5    // GPIO33 - Gaz / duman sensörü (analog AO)
#define PIN_RAIN           A1    // GPIO39 - Yağmur sensörü (analog AO)
#define PIN_VIB_AO         A4    // GPIO32 - Titreşim sensörü analog çıkış (AO, opsiyonel)
#define PIN_VIB_DO         14    // GPIO14 - Titreşim sensörü dijital çıkış (DO, opsiyonel)
#define PIN_FLAME_AO       A0    // GPIO36 - Alev sensörü analog çıkış (AO, opsiyonel)
#define PIN_FLAME_DO       4     // GPIO4  - Alev sensörü dijital çıkış (DO, opsiyonel)

/* Çıkışlar: transistörlü röle modülü / sürücü üzerinden.
   ESP32 strapping pinleri (GPIO0, 2, 5, 12, 15) ÇIKIŞ olarak kullanılmamalı. */
#define PIN_RELAY_FAN      13    // Fan (davlumbaz havalandırma)
#define PIN_RELAY_PUMP     27    // Su motoru / dalgıç pompa
/* ÖNEMLİ: Eski sürümde PIN_BUZZER=33 idi; ama Deneyap 1A'da A5=GPIO33 ve MQ2
   de A5'te olduğundan buzzer pini gaz sensörüyle ÇAKIŞIYORDU (buzzer açılınca
   gaz okuması bozuluyordu). Sesli alarm artık I2S hoparlörden (MAX98357A)
   verilir. Ayrı bir piezo/buzzer istersen buraya boş bir çıkış GPIO'su yaz
   (ör. 22) ve buzzeri oraya bağla. -1 = pasif. */
#define PIN_BUZZER         -1    // (-1 = yok; ses I2S hoparlörden çıkar)
#define PIN_SERVO_WINDOW   25    // Servo 1 - pencere kapağı
#define PIN_SERVO_BLIND    26    // Servo 2 - panjur
#define PIN_LED            -1    // Durum LED'i GPIO'su (kart üstü). Yoksa -1 bırak.

/* ---- I2S ses amplifikatörü (MAX98357A) ----
   MAX98357A bir I2S DAC + amfi modülüdür; 5V ile beslenir, çıkışı hoparlöre
   gider. Pinler GPIO matrisiyle herhangi bir serbest GPIO'ya yönlendirilir.
   SD (shutdown/kazanç) pini modülde boş bırakılırsa amfi açık kalır; -1 yeterli.
   Besleme marjinalse (USB) 5V hattına 470uF-1000uF kondansatör önerilir. */
#define PIN_I2S_BCLK       18    // D6 - bit clock  (BCLK)
#define PIN_I2S_LRC        19    // D5 - LR clock   (LRC / WS)
#define PIN_I2S_DIN        21    // D4 - data out   -> amfi DIN
#define PIN_I2S_SD         -1    // (opsiyonel) amfi shutdown/kazanç; -1 = bağlı değil

/* Servo açıları (derece) */
#define SERVO_WINDOW_OPEN  180
#define SERVO_WINDOW_SHUT  0
#define SERVO_WINDOW_AJAR  90
#define SERVO_BLIND_OPEN   180
#define SERVO_BLIND_SHUT   0

/* Servo sürücü: ESP32 yerleşik LEDC (bu çekirdekte Servo.h YOKTUR).
   50 Hz standart servo darbe genişliği; 16-bit çözünürlük; 500..2400 us. */
#define LEDC_CH_WINDOW     0
#define LEDC_CH_BLIND      1
#define SERVO_FREQ         50
#define SERVO_RES          16
#define SERVO_MIN_US       500
#define SERVO_MAX_US       2400

/* ======================= SENSÖR KALİBRASYONU =========================== */
/* MQ2 ham ADC değerini PPM'e çevirmek için doğrusal model:
     ppm = (filtre - temiz) * (GAS_PPM_FULL_SCALE / (ADC_FULL_SCALE - temiz))
   10-bit analog çözünürlük (0..1023) sabitlenir. */
#define ADC_FULL_SCALE     1023.0
#define GAS_CLEAN_SAMPLES  20            // açılışta temiz hava tabanı için örnek sayısı
#define GAS_BASE_MIN       20            // bu değerin altındaki "temiz" ölçümü şüpheli
#define GAS_BASE_MAX       900           // MQ2 (3.3V) temiz hava tabanı asla buraya yaklaşmaz;
                                         // 900+ okuma = modül raylanmış / arıza: tabanı güvenli
                                         // varsayıla döndür (yoksa span çöker, tüm oturum
                                         // -10000 ppm'e kilitlenir)
#define GAS_PPM_FULL_SCALE 10000.0       // ADC doyduğunda varsayılan ppm
#define GAS_FAULT_LOW      3             // bu ham değerin altı = sensör kopuk/arıza
#define GAS_FAULT_HIGH     1020          // bu ham değerin üstü = sensör kısa devre

/* MQ2 ısınma süresi: bu süre dolmadan `ready=false` yayınlanır ve taban
   ölçülmez. MQ-2 5V'ta ~60 sn'de oturur; ancak 3.3V'ta ısıtıcı zayıf kaldığı
   için çıkış çok daha yavaş yükselir (sahada ~60 sn'de 90, ~90 sn'de 176 ham
   değer görüldü). Bu yüzden 180 sn bekle, sonra tabanı ölç. */
#define GAS_WARMUP_MS      180000UL

/* Sensör gürültü filtreleme (Üstel Hareketli Ortalama - EMA) */
#define SENSOR_EMA_ALPHA   0.2f          // yeni ölçüm ağırlığı (0..1)

/* Yağmur sensörü: 10-bit (0..1023). Bu modülde çıkış TERS:
   KURU hava = ADC tepe (~1023), suya değince DÜŞER (tam ıslak ~520).
   Bu yüzden ham değeri RAIN_DRY_ADC (kuru) .. RAIN_WET_ADC (ıslak) aralığında
   %0..%100 ıslaklığa ölçekliyoruz. Ölçülen değerler (12 Eki 2026, ev ortamı):
   kuru=1023, tam ıslak=519..524. Farklı/ters tip modülde panelden
   rainInvert=true yapılır (çıkan yüzde ters çevrilir). */
#define RAIN_DRY_ADC       1023          // kuru havada beklenen ham ADC
#define RAIN_WET_ADC       500           // tam ıslakta beklenen ham ADC (pay bırakıldı)
#define RAIN_WET_PCT       50            // bu yüzden itibaren "ıslak"
#define RAIN_FLOOD_PCT     85            // bu yüzden itibaren "su baskını"
/* Sensör arıza/kopuk koruması: ters tip modülde beklenen en düşük mantıklı ham
   değer ~500'dür (tam ıslak). Ham değer bunun çok altına düşerse (ör. kablo
   çıkmış, AO toprağa kısa) sensör bozuk/kopuk sayılır; yanlış "su baskını"
   üretilmez (status'ta rainOk=false görünür). rainInvert=true iken uygulanmaz,
   çünkü karşı tip modülde düşük ham değer normaldir (kuru). */
#define RAIN_FAULT_LOW     40
#define FLOOD_HOLD_MS      8000UL        // selin kalıcı sayılması için gereken süre

/* ================= TİTREŞİM / SARSINTI SENSÖRÜ (SW-420 / 801S sınıfı) == */
/* Modülün hem dijital (DO) hem analog (AO) çıkışı desteklenir; hangisi
   bağlıysa o kullanılır. Dijital taraf LM393 açık kolektör olduğundan dahili
   yukarı çekme açılır; sarsıntıda DO LOW'a çekilir (VIB_DO_ACTIVE_LOW).
   Analog taraf ise yavaş bir tabana göre sapma (VIB_ANALOG_DELTA) ile
   tetiklenir; böylece modülün boştaki seviyesini bilmek gerekmez. Varsayılan
   olarak yalnızca DİJİTAL kullanılır (yaygın 3 pinli SW-420). 4 pinli (DO+AO)
   modülde panelden "analog" da açılabilir veya tam tersi. */
#define VIB_ENABLED_DEFAULT true          // açılışta sarsıntı algılama açık
#define VIB_ALARM_DEFAULT   true          // sarsıntı => tam alarm (siren+aktüatör+Telegram)
#define VIB_DIGITAL_DEFAULT true          // dijital DO girişini kullan
#define VIB_ANALOG_DEFAULT  false         // analog AO girişini kullan (4 pinli modül)
#define VIB_DO_ACTIVE_LOW   true          // DO LOW'a çekilince (sarsıntı) tetikle
#define VIB_ANALOG_DELTA    250           // AO tabandan bu kadar saparsa sarsıntı (0..1023)
#define VIB_TRIGGER_HOLD_MS 4000UL        // olay bu süre "aktif" kalsın (sarsıntı süresi)
#define VIB_ALARM_TG_DEFAULT true         // sarsıntıda Telegram bildirimi gönder

/* ================== ALEV / YANGIN SENSÖRÜ (IR Flame) ================== */
/* IR alev sensörü modülü (ör. KY-026 / LM393 tabanlı). Çoğu modülde DO,
   alev algılandığında LOW'a çekilir (aktif düşük) — titreşim modülüyle aynı
   mantık. Analog (AO) taraf ise yavaş bir tabana göre sapma ile tetiklenir;
   böylece modülün boştaki seviyesini önceden bilmek gerekmez. Varsayılan
   olarak yalnızca DİJİTAL kullanılır. Alev olayı yangın açısından en yüksek
   öncelikli alarmdır: siren çalar, pencere KAPATILIR (oksijen kesilir), fan ve
   su motoru DURDURULUR, (flameTg ise) Telegram bildirimi gider. */
#define FLAME_ENABLED_DEFAULT true        // açılışta alev algılama açık
#define FLAME_ALARM_DEFAULT   true        // alev => tam alarm (siren+aktüatör+Telegram)
#define FLAME_DIGITAL_DEFAULT true        // dijital DO girişini kullan
#define FLAME_ANALOG_DEFAULT  false       // analog AO girişini kullan (4 pinli modül)
#define FLAME_DO_ACTIVE_LOW   true        // DO LOW'a çekilince (alev) tetikle
#define FLAME_ANALOG_DELTA    250         // AO tabandan bu kadar saparsa alev (0..1023)
#define FLAME_TRIGGER_HOLD_MS 4000UL      // olay bu süre "aktif" kalsın (alev süresi)
#define FLAME_ALARM_TG_DEFAULT true       // alevde Telegram bildirimi gönder

/* ======================= SES / HOPARLÖR (I2S) ========================== */
/* Sesli alarmlar I2S amfi (MAX98357A) üzerinden hoparlörden verilir. Panelden
   ses seviyesi ve siren testi yapılabilir; AI sesli anons panel (telefon)
   tarafındaki konuşma senteziyle yapılır. */
#define SND_VOLUME_DEFAULT  70            // açılış ses seviyesi (0..100)
#define SND_SAMPLE_RATE     16000         // I2S örnekleme frekansı (Hz)

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
