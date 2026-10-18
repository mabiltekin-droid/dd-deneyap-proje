/*
 * ============================================================================
 *  Deneyap Ev Koruma Sistemi — Deneyap Kart / Arduino IDE firmware
 *  Sürüm v3.0.0  (MQTT + HTTP)
 * ----------------------------------------------------------------------------
 *  Bu kod, depodaki `pwa/` kontrol paneli ile VARSAYILAN MQTT taşıması üzerinden
 *  haberleşir; ayrıca aynı yerel ağdan HTTP JSON API de sunar.
 *
 *  ÖZELLİKLER
 *   • Wi-Fi'ye (STA) bağlanır; bağlanamazsa kendi AP'sini açar (192.168.4.1)
 *   • MQTT broker'a bağlanır, LWT ile "offline" bildirir (broker.emqx.io)
 *   • Durum JSON'unu <T>/status konusuna periyodik + retained yayınlar
 *   • <T>/cmd, <T>/settings, <T>/histreq konularını dinler
 *   • 24 saatlik RAM halka tamponu (60 sn örnek) tutar -> <T>/hist
 *   • MQ2 gaz + yağmur sensörü, EMA filtre, histerezisli durum makinesi
 *   • Fan / su motoru / buzzer röleleri ve 2 servo (pencere + panjur)
 *   • Gaz tehlikesi ve su baskınında Telegram bildirimi
 *   • HTTP eşdeğerleri: /api/status /api/control /api/settings /api/history
 *
 *  Donanım / ağ / eşik ayarları -> config.h
 *  (Bu dosya ile config.h aynı klasörde olmalı; derlemeden önce config.h'de
 *   WIFI_SSID / WIFI_PASS ve MQTT_TOPIC değerlerini doldurun.)
 *
 *  Gerekli kütüphaneler (Deneyap Kart IDE > Kütüphane Yöneticisi):
 *    - PubSubClient (Nick O'Leary)
 *  Geri kalanı Deneyap Kart (ESP32) çekirdeğiyle gelir:
 *    WiFi, WebServer, Preferences, HTTPClient, WiFiClientSecure
 *  Not: Servo.h bu çekirdekte bulunmaz; servo sürücüsü yerleşik LEDC ile yapılır.
 * ============================================================================
 */

#include <WiFi.h>
#include <WebServer.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <driver/i2s.h>

#include "config.h"

/* Brownout detektörünü kapatmak için SDK kayıt tanımları */
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

/* ------------------------------------------------------------------ durum */
enum GasState : uint8_t { GAS_NORMAL = 0, GAS_WARN = 1, GAS_DANGER = 2 };

/* Ses motoru (I2S/MAX98357A) ön tanımları. Çıkış yardımcıları (outputsSafe)
   bu sabitleri kullanabilsin diye en üstte durur. */
enum SoundMode : uint8_t { SND_NONE = 0, SND_ALARM = 1, SND_SIREN = 2, SND_TEST = 3, SND_BEEP = 4 };
static volatile uint8_t  sndMode     = SND_NONE;
static volatile uint32_t sndStartMs  = 0;
static volatile bool     sndReady    = false;
static TaskHandle_t      audioTaskH  = nullptr;

WiFiClient        netClient;
PubSubClient      mqttClient(netClient);
WebServer         server(80);
Preferences       prefs;
char              deviceId[12] = "DK-0000";   // "dev" alani: DEVICE_ID veya eFuse MAC'ten "DK-XXXX"

bool              wifiStaOk     = false;   // STA bağlı mı
bool              apActive      = false;   // yedek AP açık mı
bool              mqttOnline    = false;

/* NVS'den yüklenen dinamik ayarlar */
int               gasWarnPpm    = GAS_WARN_PPM;
int               gasDangerPpm  = GAS_DANGER_PPM;
int               gasHyst       = GAS_HYSTERESIS;
int               rainWetPct    = RAIN_WET_PCT;
int               rainFloodPct  = RAIN_FLOOD_PCT;
bool              rainInvert    = false;
bool              autoControl   = true;

/* Titreşim / sarsıntı ayarları (NVS) */
bool              vibEnabled    = VIB_ENABLED_DEFAULT;
bool              vibAlarm      = VIB_ALARM_DEFAULT;
bool              vibUseDigital = VIB_DIGITAL_DEFAULT;
bool              vibUseAnalog  = VIB_ANALOG_DEFAULT;
bool              vibTg         = VIB_ALARM_TG_DEFAULT;

/* Alev / yangın sensörü ayarları (NVS) */
bool              flameEnabled    = FLAME_ENABLED_DEFAULT;
bool              flameAlarm      = FLAME_ALARM_DEFAULT;
bool              flameUseDigital = FLAME_DIGITAL_DEFAULT;
bool              flameUseAnalog  = FLAME_ANALOG_DEFAULT;
bool              flameTg         = FLAME_ALARM_TG_DEFAULT;

/* Ses / hoparlör ayarları (NVS) */
int               sndVolume     = SND_VOLUME_DEFAULT;   // 0..100

/* Telegram */
bool              tgEnabled     = TG_ENABLED_DEFAULT;
String            tgToken       = "";
String            tgChatId      = "";

/* Sensör okumaları ve EMA */
int               gasRaw        = 0;
float             gasEma        = 0.0f;
int               gasFiltered   = 0;
int               gasPpm        = 0;
int               gasBaseRaw    = 0;
bool              gasFault      = false;
int               rainRaw       = 0;
float             rainEma       = 0.0f;
int               rainFiltered  = 0;
int               rainPct       = 0;
bool              rainWet       = false;
bool              rainOk        = true;   // sensör mantıklı bir değer veriyor mu
bool              floodRaw      = false;
bool              floodActive   = false;
uint32_t          floodStartMs  = 0;
/* Titreşim / sarsıntı okumaları */
int               vibRaw        = 0;      // AO ham ADC (0..1023)
float             vibEma        = 0.0f;   // AO yavaş taban (baseline) izleme
int               vibBase       = 0;      // AO boştaki referans
bool              vibDigital    = false;  // DO mantıksal durum (titreşim = true)
bool              vibActive     = false;  // olay aktif mi (hold penceresi)
bool              vibConnected  = false;  // en az bir giriş hareket gördü mü
uint32_t          vibHoldUntilMs = 0;
/* Alev / yangın okumaları */
int               flameRaw      = 0;      // AO ham ADC (0..1023)
float             flameEma      = 0.0f;   // AO yavaş taban (baseline) izleme
int               flameBase     = 0;      // AO boştaki referans
bool              flameDigital  = false;  // DO mantıksal durum (alev = true)
bool              flameActive   = false;  // olay aktif mi (hold penceresi)
bool              flameConnected= false;  // sensör en az bir kez tetiklendi mi
uint32_t          flameHoldUntilMs = 0;
uint32_t          warmUpUntilMs = 0;
bool              firstRead     = true;
bool              gasBaseStable = false;   // ısınma penceresi bitince taban yeniden ölçüldü mü
GasState          gasState      = GAS_NORMAL;

/* Çıkışlar */
bool              fanOn           = false;
bool              pumpOn          = false;
bool              buzzerOn        = false;
bool              fanByAutomation = false;
bool              wasDanger       = false;
bool              wasRainShut     = false;
bool              wasVibShut      = false;
bool              wasFlameOn      = false;   // alev alarmı penceresi kapatıldı mı
bool              soundManual     = false;   // panelden elle açılan ses (otomasyon ezmez)
uint32_t          alarmSimUntilMs = 0;
int               windowPos       = SERVO_WINDOW_OPEN;
int               blindPos        = SERVO_BLIND_SHUT;

/* Zamanlayıcılar */
uint32_t          bootMs          = 0;
uint32_t          lastSensorMs    = 0;
uint32_t          lastReportMs    = 0;
uint32_t          lastStatusMs    = 0;
uint32_t          lastHistMs      = 0;
uint32_t          fanLatchedMs    = 0;
uint32_t          pumpStartedMs   = 0;
uint32_t          servoReleaseAt  = 0;
uint32_t          wifiRetryAt     = 0;
uint32_t          mqttRetryAt     = 0;
uint32_t          rebootAtMs      = 0;

/* MQTT broker yedekleme + yeniden bağlanma durumu */
bool              brokerFallback    = false;            // şu an yedek broker kullanılıyor mu
uint8_t           mqttFailStreak    = 0;                // üst üste başarısız deneme sayısı
uint32_t          mqttBackoffMs     = MQTT_RETRY_MIN;   // üstel geri çekilme gecikmesi
uint32_t          mqttPrimaryProbeAt = 0;               // yedekteyken birincili yeniden dene zamanı

/* MQTT yanıt durumu */
uint32_t          lastCmdId       = 0;
String            lastCmdErr      = "";
String            cmdErrHold      = "";   // bir sonraki yayına kadar tutulur

/* Geçmiş halka tamponu (RAM) */
struct HistRec { uint32_t t; uint16_t ppm; uint8_t rain; uint8_t st; uint16_t fl; };
static HistRec    hist[HISTORY_MAX];
uint16_t          histCount = 0;
uint16_t          histHead  = 0;

/* ----------------------------------------------------------- metin/conum */
static String baseTopic() { return String(MQTT_TOPIC); }
static String statusTopic() { return baseTopic() + "/status"; }

/* ----------------------------------------------------------- NVS ayarları */
static void loadSettings() {
  prefs.begin("deneyap", true);
  gasWarnPpm   = prefs.getInt("gasWarn", GAS_WARN_PPM);
  gasDangerPpm = prefs.getInt("gasDanger", GAS_DANGER_PPM);
  gasHyst      = prefs.getInt("gasHyst", GAS_HYSTERESIS);
  rainWetPct   = prefs.getInt("rainWet", RAIN_WET_PCT);
  rainFloodPct = prefs.getInt("rainFlood", RAIN_FLOOD_PCT);
  rainInvert   = prefs.getBool("rainInvert", false);
  autoControl  = prefs.getBool("autoControl", true);
  vibEnabled   = prefs.getBool("vibEnabled", VIB_ENABLED_DEFAULT);
  vibAlarm     = prefs.getBool("vibAlarm", VIB_ALARM_DEFAULT);
  vibUseDigital= prefs.getBool("vibDigital", VIB_DIGITAL_DEFAULT);
  vibUseAnalog = prefs.getBool("vibAnalog", VIB_ANALOG_DEFAULT);
  vibTg        = prefs.getBool("vibTg", VIB_ALARM_TG_DEFAULT);
  flameEnabled = prefs.getBool("flameEnabled", FLAME_ENABLED_DEFAULT);
  flameAlarm   = prefs.getBool("flameAlarm", FLAME_ALARM_DEFAULT);
  flameUseDigital = prefs.getBool("flameDigital", FLAME_DIGITAL_DEFAULT);
  flameUseAnalog  = prefs.getBool("flameAnalog", FLAME_ANALOG_DEFAULT);
  flameTg      = prefs.getBool("flameTg", FLAME_ALARM_TG_DEFAULT);
  sndVolume    = prefs.getInt("sndVol", SND_VOLUME_DEFAULT);
  tgEnabled    = prefs.getBool("tgEnabled", TG_ENABLED_DEFAULT);
  tgToken      = prefs.getString("tgToken", "");
  tgChatId     = prefs.getString("tgChat", "");
  prefs.end();

  if (gasWarnPpm <= 0) gasWarnPpm = GAS_WARN_PPM;
  if (gasDangerPpm <= gasWarnPpm) gasDangerPpm = GAS_DANGER_PPM;
  if (gasHyst < 0 || gasHyst >= gasWarnPpm) gasHyst = GAS_HYSTERESIS;
  if (rainWetPct < 1 || rainWetPct > 100) rainWetPct = RAIN_WET_PCT;
  if (rainFloodPct <= rainWetPct || rainFloodPct > 100) rainFloodPct = RAIN_FLOOD_PCT;
  if (sndVolume < 0 || sndVolume > 100) sndVolume = SND_VOLUME_DEFAULT;
  Serial.println(F("[nvs] ayarlar yuklendi"));
}

static void saveSettings() {
  prefs.begin("deneyap", false);
  prefs.putInt("gasWarn", gasWarnPpm);
  prefs.putInt("gasDanger", gasDangerPpm);
  prefs.putInt("gasHyst", gasHyst);
  prefs.putInt("rainWet", rainWetPct);
  prefs.putInt("rainFlood", rainFloodPct);
  prefs.putBool("rainInvert", rainInvert);
  prefs.putBool("autoControl", autoControl);
  prefs.putBool("vibEnabled", vibEnabled);
  prefs.putBool("vibAlarm", vibAlarm);
  prefs.putBool("vibDigital", vibUseDigital);
  prefs.putBool("vibAnalog", vibUseAnalog);
  prefs.putBool("vibTg", vibTg);
  prefs.putBool("flameEnabled", flameEnabled);
  prefs.putBool("flameAlarm", flameAlarm);
  prefs.putBool("flameDigital", flameUseDigital);
  prefs.putBool("flameAnalog", flameUseAnalog);
  prefs.putBool("flameTg", flameTg);
  prefs.putInt("sndVol", sndVolume);
  prefs.putBool("tgEnabled", tgEnabled);
  prefs.putString("tgToken", tgToken);
  prefs.putString("tgChat", tgChatId);
  prefs.end();
  Serial.println(F("[nvs] ayarlar kaydedildi"));
}

/* -------------------------------------------------------------- yardımcı */
static bool timeReached(uint32_t now, uint32_t since, uint32_t interval) {
  return (uint32_t)(now - since) >= interval;
}

static const char *gasStateName(GasState s) {
  switch (s) {
    case GAS_DANGER: return "danger";
    case GAS_WARN:   return "warning";
    default:         return "normal";
  }
}

static void outputsSafe(const char *reason) {
  digitalWrite(PIN_RELAY_FAN, LOW);
  digitalWrite(PIN_RELAY_PUMP, LOW);
#if PIN_BUZZER >= 0
  digitalWrite(PIN_BUZZER, LOW);
#endif
  fanOn = pumpOn = buzzerOn = false;
  fanByAutomation = false;
  if (sndMode == SND_ALARM) sndStop();
  if (reason) { Serial.print(F("[guvenlik] cikislar kapatildi: ")); Serial.println(reason); }
}

/* ------------------------------------------------------- JSON yardımcıları */
static int jsonKeyPos(const String &body, const char *key) {
  return body.indexOf(String("\"") + key + "\"");
}
static bool jsonGetStr(const String &body, const char *key, String &out) {
  int p = jsonKeyPos(body, key);
  if (p < 0) return false;
  p = body.indexOf(':', p);
  if (p < 0) return false;
  int q1 = body.indexOf('"', p);
  if (q1 < 0) return false;
  int q2 = body.indexOf('"', q1 + 1);
  if (q2 < 0) return false;
  out = body.substring(q1 + 1, q2);
  return true;
}
static bool jsonGetNum(const String &body, const char *key, long &out) {
  int p = jsonKeyPos(body, key);
  if (p < 0) return false;
  p = body.indexOf(':', p);
  if (p < 0) return false;
  while (p < (int)body.length() && (body[p] == ' ' || body[p] == ':')) p++;
  out = strtol(body.c_str() + p, nullptr, 10);
  return true;
}
static bool jsonGetBool(const String &body, const char *key, bool &out) {
  int p = jsonKeyPos(body, key);
  if (p < 0) return false;
  p = body.indexOf(':', p);
  if (p < 0) return false;
  while (p < (int)body.length() && (body[p] == ' ' || body[p] == ':')) p++;
  if (body.startsWith("true", p)  || body.startsWith("1", p) || body.startsWith("\"true\"", p))  { out = true;  return true; }
  if (body.startsWith("false", p) || body.startsWith("0", p) || body.startsWith("\"false\"", p)) { out = false; return true; }
  return false;
}
static String jsonEscape(const String &s) {
  String o; o.reserve(s.length() + 8);
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '"' || c == '\\') { o += '\\'; o += c; }
    else if (c == '\n') o += "\\n";
    else if (c == '\r') { /* yut */ }
    else o += c;
  }
  return o;
}

/* ============================================================ SES MOTORU ==
   I2S amplifikatör (MAX98357A) üzerinden siren/ton üretimi. Ayrı bir FreeRTOS
   görevi (core 0) DMA tamponunu besler; ana döngü (MQTT/HTTP) bloklanmaz.
   Sesli "anons" (konuşma) panel tarafında, telefonun konuşma senteziyle
   yapılır; buradaki motor yalnızca siren/uyarı tonları çalar. */
static const char *sndName(uint8_t m) {
  switch (m) {
    case SND_ALARM: return "alarm";
    case SND_SIREN: return "siren";
    case SND_TEST:  return "test";
    case SND_BEEP:  return "bip";
    default:        return "kapali";
  }
}
static void sndPlay(uint8_t m) { sndStartMs = millis(); sndMode = m; }
static void sndStop()          { sndMode = SND_NONE; }

static void i2sInit() {
#if PIN_I2S_BCLK >= 0
  i2s_config_t cfg;
  memset(&cfg, 0, sizeof(cfg));
  cfg.mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX);
  cfg.sample_rate          = SND_SAMPLE_RATE;
  cfg.bits_per_sample      = I2S_BITS_PER_SAMPLE_16BIT;
  cfg.channel_format       = I2S_CHANNEL_FMT_RIGHT_LEFT;   // iki kanala da aynı örnek (kanal seçimi önemsiz)
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags     = 0;
  cfg.dma_buf_count        = 6;
  cfg.dma_buf_len          = 128;
  cfg.use_apll             = false;
  cfg.tx_desc_auto_clear   = true;
  cfg.fixed_mclk           = 0;
  cfg.mclk_multiple        = I2S_MCLK_MULTIPLE_256;
  if (i2s_driver_install(I2S_NUM_0, &cfg, 0, nullptr) != ESP_OK) {
    Serial.println(F("[ses] I2S surucusu kurulamadi"));
    return;
  }
  i2s_pin_config_t pins;
  memset(&pins, 0, sizeof(pins));
  pins.bck_io_num   = PIN_I2S_BCLK;
  pins.ws_io_num    = PIN_I2S_LRC;
  pins.data_out_num = PIN_I2S_DIN;
  pins.data_in_num  = I2S_PIN_NO_CHANGE;
  i2s_set_pin(I2S_NUM_0, &pins);
  i2s_zero_dma_buffer(I2S_NUM_0);
#if PIN_I2S_SD >= 0
  pinMode(PIN_I2S_SD, OUTPUT);
  digitalWrite(PIN_I2S_SD, LOW);   // boşta amfiyi kapat (gürültü olmasın)
#endif
  sndReady = true;
  Serial.println(F("[ses] I2S hoparlor hazir (MAX98357A)"));
#endif
}

/* 16-bit örnek üretici: kare dalga siren/ton. freq<=0 => sessizlik. */
static void audioTask(void *arg) {
  const int N = 128;
  static int16_t buf[256];   // stereo: 128 kare * 2
  uint32_t phase = 0;
  for (;;) {
    uint8_t m = sndMode;
    if (m == SND_NONE || !sndReady) {
      vTaskDelay(15 / portTICK_PERIOD_MS);
      continue;
    }
    uint32_t el = millis() - sndStartMs;
    int freq = 0;
    switch (m) {
      case SND_ALARM: {                       // 900/1300 Hz dönüşümlü (250 ms)
        freq = ((el / 250) & 1) ? 1300 : 900;
        break;
      }
      case SND_SIREN: {                       // 2 sn'de 600->1400->600 süpürme
        uint32_t p = el % 2000;
        freq = (p < 1000) ? (600 + (int)(800 * p / 1000))
                          : (1400 - (int)(800 * (p - 1000) / 1000));
        break;
      }
      case SND_TEST: {                        // 3 kısa bip (150 ms on / 200 ms off)
        if (el > 1050) { sndMode = SND_NONE; break; }
        freq = ((el % 350) < 150) ? 1000 : 0;
        break;
      }
      case SND_BEEP: {                        // tek 150 ms bip
        if (el > 150) { sndMode = SND_NONE; break; }
        freq = 1200;
        break;
      }
      default: break;
    }
    int amp = 0;
    if (freq > 0) {
      int vol = sndVolume; if (vol < 0) vol = 0; if (vol > 100) vol = 100;
      amp = (int)(30000L * vol / 100);        // tam ölçek ~30000 (kırpma yok)
    }
    uint32_t inc = (uint32_t)(((uint64_t)freq << 32) / SND_SAMPLE_RATE);
    for (int i = 0; i < N; i++) {
      int16_t v = 0;
      if (amp) { phase += inc; v = (phase & 0x80000000UL) ? (int16_t)amp : (int16_t)(-amp); }
      buf[i * 2]     = v;
      buf[i * 2 + 1] = v;
    }
    size_t written = 0;
    i2s_write(I2S_NUM_0, buf, sizeof(buf), &written, portMAX_DELAY);
#if PIN_I2S_SD >= 0
    pinMode(PIN_I2S_SD, INPUT);   // çalarken amfiyi serbest bırak (açık)
#endif
    if (sndMode == SND_NONE) {
#if PIN_I2S_SD >= 0
      pinMode(PIN_I2S_SD, OUTPUT); digitalWrite(PIN_I2S_SD, LOW);
#endif
    }
  }
}
static void audioStart() {
  if (!sndReady) return;
  xTaskCreatePinnedToCore(audioTask, "ses", 4096, nullptr, 3, &audioTaskH, 0);
}

/* --------------------------------------------------------------- çıkışlar */
static void setFan(bool on, bool byAutomation) {
  digitalWrite(PIN_RELAY_FAN, on ? HIGH : LOW);
  fanOn = on;
  fanByAutomation = on && byAutomation;
  if (on && byAutomation) fanLatchedMs = millis();
}
static void setPump(bool on) {
  if (on && gasState == GAS_DANGER) {
    Serial.println(F("[guvenlik] gaz alarmi aktif - su motoru calistirilmadi"));
    digitalWrite(PIN_RELAY_PUMP, LOW);
    pumpOn = false;
    return;
  }
  digitalWrite(PIN_RELAY_PUMP, on ? HIGH : LOW);
  pumpOn = on;
  pumpStartedMs = on ? millis() : 0;
}
static void setBuzzer(bool on) {
  buzzerOn = on;
#if PIN_BUZZER >= 0
  digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
#endif
  /* Sesli alarmı I2S hoparlöre yönlendir (test/bip çalarken kesme). */
  if (on) { if (sndMode == SND_NONE) sndPlay(SND_ALARM); }
  else if (sndMode == SND_ALARM) sndStop();
}
/* Servo sürücü: Servo.h yerine ESP32 yerleşik LEDC (Deneyap çekirdeğinde
   Servo.h yoktur). Sürekli dönen aktüatörlerde "stop" işlemi pini INPUT
   yapıp sürücüyü bırakır (motor ısınmaz, kendi frenine geçer).

   LEDC API'si çekirdek sürümleri arasında değişti:
     2.x : ledcSetup(ch,freq,res) + ledcAttachPin(pin,ch) + ledcWrite(ch,duty) + ledcDetachPin(pin)
     3.x : ledcAttach(pin,freq,res)                      + ledcWrite(pin,duty) + ledcDetach(pin)
   Aşağıdaki makrolar ikisini de destekler; elle sürüm seçmek gerekmez. */
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  #define SERVO_PWM_ATTACH(pin, ch, freq, res)  do { (void)(ch); ledcAttach((pin), (freq), (res)); } while (0)
  #define SERVO_PWM_WRITE(pin, ch, duty)        do { (void)(ch); ledcWrite((pin), (duty)); } while (0)
  #define SERVO_PWM_DETACH(pin, ch)             do { (void)(ch); ledcDetach((pin)); } while (0)
#else
  #define SERVO_PWM_ATTACH(pin, ch, freq, res)  do { ledcSetup((ch), (freq), (res)); ledcAttachPin((pin), (ch)); } while (0)
  #define SERVO_PWM_WRITE(pin, ch, duty)        do { ledcWrite((ch), (duty)); } while (0)
  #define SERVO_PWM_DETACH(pin, ch)             do { ledcDetachPin((pin)); } while (0)
#endif

static bool servoAttached[2] = { false, false };   // 0: pencere, 1: panjur

static void servoDrive(uint8_t pin, uint8_t ch, int angle) {
  if (angle < 0)   angle = 0;
  if (angle > 180) angle = 180;
  uint32_t us   = (uint32_t)SERVO_MIN_US +
                   ((uint32_t)(SERVO_MAX_US - SERVO_MIN_US) * (uint32_t)angle) / 180UL;
  /* 50 Hz => periyot 20000 us; duty = us * (2^RES - 1) / 20000 */
  uint32_t duty = (us * ((1UL << SERVO_RES) - 1UL)) / 20000UL;
  uint8_t slot = (ch == LEDC_CH_WINDOW) ? 0 : 1;
  if (!servoAttached[slot]) {
    /* pinMode ÖNCE: sonradan çağrılırsa pinin LEDC matris bağlantısını koparır */
    pinMode(pin, OUTPUT);
    SERVO_PWM_ATTACH(pin, ch, SERVO_FREQ, SERVO_RES);
    servoAttached[slot] = true;
  }
  SERVO_PWM_WRITE(pin, ch, duty);
}
static void servoRelease(uint8_t pin, uint8_t ch) {
  uint8_t slot = (ch == LEDC_CH_WINDOW) ? 0 : 1;
  if (servoAttached[slot]) {
    SERVO_PWM_DETACH(pin, ch);
    servoAttached[slot] = false;
  }
  pinMode(pin, INPUT);
  servoReleaseAt = 0;
}
static void setWindow(int angle) {
  servoDrive(PIN_SERVO_WINDOW, LEDC_CH_WINDOW, angle);
  windowPos = angle;
  servoReleaseAt = millis() + SERVO_MOVE_MS;
  Serial.print(F("[servo] pencere -> ")); Serial.println(angle);
}
static void setBlind(int angle) {
  servoDrive(PIN_SERVO_BLIND, LEDC_CH_BLIND, angle);
  blindPos = angle;
  servoReleaseAt = millis() + SERVO_MOVE_MS;
  Serial.print(F("[servo] panjur  -> ")); Serial.println(angle);
}

/* ------------------------------------------------------ sensör + otomasyon */
static void calibrateGasBaseline() {
  long sum = 0; int n = 0;
  for (int i = 0; i < GAS_CLEAN_SAMPLES; i++) {
    int v = analogRead(PIN_MQ2);
    if (v > GAS_BASE_MIN) { sum += v; n++; }
    delay(100);
  }
  gasBaseRaw = (n > 0) ? (int)(sum / n) : 200;
  /* Plausibility: 900+ taban = modül raylanmış / sensör yok (gerçek MQ2
     temiz hava 3.3V'da ~150-350). Böyle taban span'i çökertir. */
  if (gasBaseRaw < GAS_BASE_MIN || gasBaseRaw > GAS_BASE_MAX) gasBaseRaw = 200;
  gasEma = (float)gasBaseRaw;
  gasFiltered = gasBaseRaw;
  Serial.print(F("[mq2] temiz hava tabani=")); Serial.println(gasBaseRaw);
}

static void readSensors() {
  gasRaw  = analogRead(PIN_MQ2);
  rainRaw = analogRead(PIN_RAIN);
  vibRaw  = (PIN_VIB_AO >= 0) ? analogRead(PIN_VIB_AO) : 0;
  int vibDoLevel = (PIN_VIB_DO >= 0) ? digitalRead(PIN_VIB_DO) : HIGH;
  flameRaw = (PIN_FLAME_AO >= 0) ? analogRead(PIN_FLAME_AO) : 0;
  int flameDoLevel = (PIN_FLAME_DO >= 0) ? digitalRead(PIN_FLAME_DO) : HIGH;

  if (firstRead) { gasEma = gasRaw; rainEma = rainRaw; vibEma = vibRaw; flameEma = flameRaw; firstRead = false; }
  else {
    gasEma  = (SENSOR_EMA_ALPHA * gasRaw)  + ((1.0f - SENSOR_EMA_ALPHA) * gasEma);
    rainEma = (SENSOR_EMA_ALPHA * rainRaw) + ((1.0f - SENSOR_EMA_ALPHA) * rainEma);
    /* AO yavaş taban: gerçek sarsıntının tabanı kaydırmaması için çok yavaş izle */
    vibEma  = (0.02f * vibRaw) + (0.98f * vibEma);
    /* Alev AO da yavaş taban (alev algısındaki parlaklık kaymasını izler) */
    flameEma = (0.02f * flameRaw) + (0.98f * flameEma);
  }
  gasFiltered  = (int)(gasEma + 0.5f);
  rainFiltered = (int)(rainEma + 0.5f);
  vibBase      = (int)(vibEma + 0.5f);
  flameBase    = (int)(flameEma + 0.5f);

  /* Gaz sensörü arıza tespiti (kopuk / kısa devre) */
  gasFault = (gasRaw <= GAS_FAULT_LOW) || (gasRaw >= GAS_FAULT_HIGH);

  /* Ham ADC -> PPM (doğrusal model) */
  if (gasBaseRaw < GAS_BASE_MIN || gasBaseRaw > GAS_BASE_MAX) gasBaseRaw = 200;
  /* Uyarlanabilir taban: MQ-2 (özellikle 3.3V'da) saatler içinde yavaşça kayar.
     Temiz hava varsayımıyla (ppm uyarı eşiğinin altında) tabanı yavaşça okumaya
     doğru çek; gaz şüphesi varsa DOKUNMA ki gerçek gazı yutup alarmı maskeleme.
     Isınma bitmeden (gasBaseStable) çalışmaz. */
  if (gasBaseStable && !gasFault && gasPpm < gasWarnPpm) {
    gasBaseRaw += (int)((gasFiltered - gasBaseRaw) * 0.01f);
    if (gasBaseRaw < GAS_BASE_MIN || gasBaseRaw > GAS_BASE_MAX) gasBaseRaw = 200;
  }
  float span = ADC_FULL_SCALE - (float)gasBaseRaw;
  if (span <= 0) span = 1.0f;
  float ppm = ((float)gasFiltered - (float)gasBaseRaw) * (GAS_PPM_FULL_SCALE / span);
  /* Tabanın ALTINDAKİ okumalar 0'a kırpılmaz: gasPpm negatifse okuma temiz
     hava tabanının altında demektir (sensör boşta / henüz ısınmamış).
     Alarm eşikleri pozitif ppm ile karşılaştırıldığından negatif değer
     uyarı tetiklemez; panel ve geçmiş kaydı 0'a kırpar. */
  gasPpm = (int)(ppm + 0.5f);
  if (gasPpm < (int)(-GAS_PPM_FULL_SCALE)) gasPpm = (int)(-GAS_PPM_FULL_SCALE);
  if (gasPpm > (int)GAS_PPM_FULL_SCALE)   gasPpm = (int)GAS_PPM_FULL_SCALE;

  /* Yağmur: ham ADC'yi kalibre edilmiş aralıkta %0 (kuru) .. %100 (ıslak)
     ıslaklığa çevir. Bu modül ters (kuru=tepe, ıslak=düşük); rainInvert=true
     ise çıkan yüzde ters çevrilerek karşı tip modüller de desteklenir. */
  /* Arıza/kopuk koruması: ters tip modülde kuru hava ~1023, tam ıslak ~500
     verir; ham değer bunun çok altına (RAIN_FAULT_LOW) düşerse sensör
     kopuk/kısa sayılır ve YANLIŞ "su baskını" üretilmez. rainInvert açıkken
     (karşı tip modül) bu koruma uygulanmaz, çünkü orada düşük değer normaldir. */
  rainOk = rainInvert || ((long)rainRaw >= (long)RAIN_FAULT_LOW);
  if (rainOk) {
    long rspan = (long)RAIN_DRY_ADC - (long)RAIN_WET_ADC;
    if (rspan == 0) rspan = 1;
    int wetness = (int)(( (long)RAIN_DRY_ADC - (long)rainFiltered) * 100 / rspan);
    if (wetness < 0)   wetness = 0;
    if (wetness > 100) wetness = 100;
    if (rainInvert)    wetness = 100 - wetness;
    rainPct = wetness;
    rainWet = rainPct >= rainWetPct;
    floodRaw = rainPct >= rainFloodPct;
  } else {
    rainPct = 0;
    rainWet = false;
    floodRaw = false;
  }

  /* Su baskını: eşik üstünde FLOOD_HOLD_MS boyunca kalırsa kalıcı say */
  uint32_t now = millis();
  if (floodRaw) {
    if (floodStartMs == 0) floodStartMs = now;
    if (!floodActive && timeReached(now, floodStartMs, FLOOD_HOLD_MS)) {
      floodActive = true;
      Serial.println(F("[otomasyon] SU BASKINI algilandi"));
    }
  } else {
    floodStartMs = 0;
    floodActive = false;
  }

  /* Titreşim / sarsıntı: dijital DO (LOW=olay) ve/veya analog AO (tabandan
     sapma). Herhangi biri tetiklerse olay VIB_TRIGGER_HOLD_MS boyunca aktif
     kalır (beliren sarsıntı serileri tek olay sayılır). */
  bool vibDigitalNow = false;
  if (vibEnabled && vibUseDigital) {
    bool low = (vibDoLevel == LOW);
    vibDigitalNow = VIB_DO_ACTIVE_LOW ? low : !low;
  }
  bool vibAnalogNow = false;
  if (vibEnabled && vibUseAnalog) {
    int dev = vibRaw - vibBase; if (dev < 0) dev = -dev;
    vibAnalogNow = (vibRaw > 5) && (dev >= VIB_ANALOG_DELTA);
  }
  vibDigital = vibDigitalNow;
  if (vibDigitalNow || vibAnalogNow) {
    vibHoldUntilMs = now + VIB_TRIGGER_HOLD_MS;
    vibConnected = true;
  }
  vibActive = vibEnabled && ((int32_t)(vibHoldUntilMs - now) > 0);

  /* Alev / yangın: titreşimle aynı mantık. Dijital DO (LOW=alev) ve/veya
     analog AO (tabandan sapma). Herhangi biri tetiklerse olay
     FLAME_TRIGGER_HOLD_MS boyunca aktif kalır (alev titremeleri tek olay). */
  bool flameDigitalNow = false;
  if (flameEnabled && flameUseDigital) {
    bool low = (flameDoLevel == LOW);
    flameDigitalNow = FLAME_DO_ACTIVE_LOW ? low : !low;
  }
  bool flameAnalogNow = false;
  if (flameEnabled && flameUseAnalog) {
    int dev = flameRaw - flameBase; if (dev < 0) dev = -dev;
    flameAnalogNow = (flameRaw > 5) && (dev >= FLAME_ANALOG_DELTA);
  }
  flameDigital = flameDigitalNow;
  if (flameDigitalNow || flameAnalogNow) {
    flameHoldUntilMs = now + FLAME_TRIGGER_HOLD_MS;
    flameConnected = true;
  }
  flameActive = flameEnabled && ((int32_t)(flameHoldUntilMs - now) > 0);

  /* Isınma süresi dolmadan güvenli tarafta kal */
  if ((int32_t)(warmUpUntilMs - now) > 0) {
    gasState = GAS_NORMAL;
    return;
  }

  /* Alarm simülasyonu */
  if ((int32_t)(alarmSimUntilMs - now) > 0) {
    gasState = GAS_DANGER;
    return;
  }

  if (gasFault) { gasState = GAS_NORMAL; return; }

  /* Histerezisli durum makinesi */
  GasState prev = gasState;
  switch (gasState) {
    case GAS_NORMAL:
      if (gasPpm >= gasDangerPpm)     gasState = GAS_DANGER;
      else if (gasPpm >= gasWarnPpm)  gasState = GAS_WARN;
      break;
    case GAS_WARN:
      if (gasPpm >= gasDangerPpm)                    gasState = GAS_DANGER;
      else if (gasPpm < (gasWarnPpm - gasHyst))      gasState = GAS_NORMAL;
      break;
    case GAS_DANGER:
      if (gasPpm < (gasDangerPpm - gasHyst))         gasState = GAS_WARN;
      break;
  }
  if (gasState != prev) {
    Serial.print(F("[durum] gaz -> ")); Serial.print(gasStateName(gasState));
    Serial.print(F("  ppm=")); Serial.println(gasPpm);
  }
}

static void runAutomation() {
  uint32_t now = millis();
  bool alarmSound = false;

  /* 0) Alev / yangın (EN YÜKSEK öncelik — gazdan da önce) */
  if (flameAlarm && flameActive) {
    alarmSound = true;                       // siren: oto kapalı olsa da çalar (güvenlik)
    if (autoControl) {
      setFan(false, false);                  // yangına oksijen pompalamayı ÖNLE
      setPump(false);
      if (!wasFlameOn) {
        setWindow(SERVO_WINDOW_SHUT);        // oksijeni kes
        wasFlameOn = true;
        Serial.println(F("[otomasyon] ALEV -> pencere kapatildi, siren"));
        if (flameTg) tgSend(String("ALEV/YANGIN algilandi! Siren caliyor, pencere kapatildi. Cihaz: ") + deviceId, false);
        pushNotify("flame");
      }
    } else if (!wasFlameOn) {
      wasFlameOn = true;
      if (flameTg) tgSend(String("ALEV/YANGIN algilandi (otomasyon kapali). Cihaz: ") + deviceId, false);
      pushNotify("flame");
    }
    setBuzzer(alarmSound || soundManual);
    return;
  }
  if (wasFlameOn) {
    wasFlameOn = false;
    if (fanByAutomation) setFan(false, false);
    if (autoControl && gasState != GAS_DANGER) {
      if (rainWet) { setWindow(SERVO_WINDOW_SHUT); wasRainShut = true; }
      else         { setWindow(SERVO_WINDOW_OPEN); wasRainShut = false; }
    }
  }

  /* 1) Gaz tehlikesi (en yüksek öncelik) */
  if (gasState == GAS_DANGER) {
    alarmSound = true;
    setFan(true, true);
    setPump(false);
    if (autoControl && !wasDanger) setWindow(SERVO_WINDOW_SHUT);
    wasDanger = true;
    setBuzzer(alarmSound || soundManual);
    return;
  }

  if (fanByAutomation && timeReached(now, fanLatchedMs, FAN_AUTO_OFF_MS)) setFan(false, false);

  if (wasDanger && gasState != GAS_DANGER) {
    wasDanger = false;
    if (autoControl) {
      if (rainWet) { setWindow(SERVO_WINDOW_SHUT); wasRainShut = true; }
      else         { setWindow(SERVO_WINDOW_OPEN); wasRainShut = false; }
    }
  }

  /* 1.5) Titreşim / kurcalama alarmı (gaz tehlikesinden sonra, yağmurdan önce) */
  if (vibAlarm && vibActive) {
    alarmSound = true;                       // siren: oto kapalı olsa da çalar (güvenlik)
    if (autoControl) {
      setPump(false);
      setFan(true, true);
      if (!wasVibShut) {
        setWindow(SERVO_WINDOW_SHUT);
        wasVibShut = true;
        Serial.println(F("[otomasyon] TITRESIM -> pencere kapatildi, siren"));
        if (vibTg) tgSend(String("SARSINTI/KURCALAMA algilandi! Siren caliyor, pencere kapatildi. Cihaz: ") + deviceId, false);
        pushNotify("vib");
      }
    } else if (!wasVibShut) {
      wasVibShut = true;
      if (vibTg) tgSend(String("SARSINTI/KURCALAMA algilandi (otomasyon kapali). Cihaz: ") + deviceId, false);
      pushNotify("vib");
    }
  } else if (wasVibShut) {
    wasVibShut = false;
    if (fanByAutomation) setFan(false, false);
    if (autoControl && gasState != GAS_DANGER) {
      if (rainWet) { setWindow(SERVO_WINDOW_SHUT); wasRainShut = true; }
      else         { setWindow(SERVO_WINDOW_OPEN); wasRainShut = false; }
    }
  }

  /* 2) Yağmur / sel otomasyonu */
  if (autoControl) {
    if (rainWet) {
      if (!wasRainShut && windowPos != SERVO_WINDOW_SHUT) {
        setWindow(SERVO_WINDOW_SHUT);
        wasRainShut = true;
        Serial.println(F("[otomasyon] Yagmur -> pencere kapatildi"));
      }
    } else if (wasRainShut) {
      wasRainShut = false;
      setWindow(SERVO_WINDOW_OPEN);
      Serial.println(F("[otomasyon] Yagmur dindi -> pencere acildi"));
    }
  }

  /* 3) Ses kararı: alarm veya panelden elle açık ise siren çal */
  setBuzzer(alarmSound || soundManual);
}

/* ------------------------------------------------------------- Telegram */
static bool tgSend(const String &text, bool force) {
  if (!force && !tgEnabled) return false;
  if (tgToken.length() == 0 || tgChatId.length() == 0) return false;
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure sec; sec.setInsecure();
  HTTPClient http;
  http.setConnectTimeout(8000);
  http.setTimeout(8000);
  String url = "https://api.telegram.org/bot" + tgToken + "/sendMessage";
  if (!http.begin(sec, url)) return false;
  http.addHeader("Content-Type", "application/json");
  String body = "{\"chat_id\":\"" + tgChatId + "\",\"text\":\"" + jsonEscape(text) + "\"}";
  int code = http.POST(body);
  http.end();
  Serial.print(F("[tg] gonderim kodu: ")); Serial.println(code);
  return code == 200;
}

/* ----------------------------------------------------- uzak bildirim (push) */
/* Panel kapalıyken de bildirim için Vercel göndericisine (api/push.js) kısa
   bir HTTPS isteği atar. Panel tarafındaki tür tercihleri göndericide tutulur;
   cihaz yalnızca "şu tür olay oldu" bilgisini + cihaz kimliğini iletir.
   Aynı türden 30 sn içinde tek istek gider (alarm titremeleri tek bildirim). */
static bool pushNotify(const char *kind) {
  if (strlen(PUSH_URL) == 0 || strlen(PUSH_SECRET) == 0) return false;
  if (WiFi.status() != WL_CONNECTED) return false;

  int idx = 3;
  if      (!strcmp(kind, "flame")) idx = 0;
  else if (!strcmp(kind, "gas"))   idx = 1;
  else if (!strcmp(kind, "flood")) idx = 2;
  static uint32_t pushLastMs[4] = { 0, 0, 0, 0 };
  uint32_t now = millis();
  if (pushLastMs[idx] != 0 && (uint32_t)(now - pushLastMs[idx]) < 30000UL) return false;
  pushLastMs[idx] = now;

  WiFiClientSecure sec; sec.setInsecure();      // kök sertifika yüklenmez (pin sınırı)
  HTTPClient http;
  http.setConnectTimeout(6000);
  http.setTimeout(6000);
  if (!http.begin(sec, PUSH_URL)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-dd-secret", PUSH_SECRET);
  String body = String("{\"device\":\"") + deviceId + "\",\"kind\":\"" + kind + "\"}";
  int code = http.POST(body);
  http.end();
  Serial.print(F("[push] gonderim kodu: ")); Serial.println(code);
  return code == 200 || code == 202;
}

/* --------------------------------------------------------------- geçmiş */
static int histIndex(int i) {
  int start = ((int)histHead - (int)histCount + HISTORY_MAX) % HISTORY_MAX;
  return (start + i) % HISTORY_MAX;
}
static void historyPush() {
  HistRec &r = hist[histHead];
  r.t = (uint32_t)((millis() - bootMs) / 1000UL);
  r.ppm = (uint16_t)(gasPpm < 0 ? 0 : (gasPpm > 65000 ? 65000 : gasPpm));
  r.rain = (uint8_t)(rainPct < 0 ? 0 : (rainPct > 100 ? 100 : rainPct));
  r.st = (uint8_t)(gasFault ? 3 : (uint8_t)gasState);
  uint16_t fl = 0;
  if (fanOn)             fl |= 1;
  if (pumpOn)            fl |= 2;
  if (buzzerOn)          fl |= 4;
  if (windowPos > 150)   fl |= 8;
  if (blindPos > 30)     fl |= 16;
  if (floodActive)       fl |= 32;
  if (autoControl)       fl |= 64;
  if (vibActive)         fl |= 128;
  if (flameActive)       fl |= 256;
  r.fl = fl;
  histHead = (histHead + 1) % HISTORY_MAX;
  if (histCount < HISTORY_MAX) histCount++;
}
static String buildHistJson(long id, long n, long last) {
  int window = histCount;
  if (last > 0 && last < window) window = (int)last;
  int pts = (int)n;
  if (pts < 1) pts = 140;
  if (pts > window) pts = window;

  String j; j.reserve(48 + pts * 24);
  j += "{\"id\":"; j += id; j += ",\"recs\":[";
  int base = (int)histCount - window;
  for (int i = 0; i < pts; i++) {
    int ci = base + (int)((long)i * window / pts);
    if (ci >= (int)histCount) ci = (int)histCount - 1;
    HistRec &r = hist[histIndex(ci)];
    if (i) j += ',';
    j += '['; j += (unsigned long)r.t;
    j += ','; j += r.ppm;
    j += ','; j += r.rain;
    j += ','; j += r.st;
    j += ','; j += r.fl; j += ']';
  }
  j += "]}";
  return j;
}

/* ------------------------------------------------------------ durum JSON */
/* Efuse MAC'in alt 16 bitinden "DK-XXXX" kalici kimlik uretimi (tek acilista
   sabit, kart degisince degisir => eskiden beri panelin gordugu DK-1744 gibi).
   DEVICE_ID doluysa o ad kullanilir. */
static void makeDeviceId() {
  if (DEVICE_ID[0]) { snprintf(deviceId, sizeof(deviceId), "%s", DEVICE_ID); return; }
  uint64_t mac = ESP.getEfuseMac();
  snprintf(deviceId, sizeof(deviceId), "DK-%04X", (unsigned int)(mac & 0xFFFFUL));
}

static String buildStatus() {
  uint32_t now = millis();
  bool moving  = (int32_t)(servoReleaseAt - now) > 0;
  int  warmLeft = 0;
  if ((int32_t)(warmUpUntilMs - now) > 0) warmLeft = (int)((warmUpUntilMs - now) / 1000UL);
  bool ready = (warmLeft == 0) && gasBaseStable;
  long pumpLeft = 0;
  if (pumpOn && pumpStartedMs) {
    long e = (long)(now - pumpStartedMs);
    pumpLeft = (e < (long)PUMP_MAX_RUN_MS) ? ((long)PUMP_MAX_RUN_MS - e) : 0;
  }
  int clients = apActive ? (int)WiFi.softAPgetStationNum() : (wifiStaOk ? 1 : 0);
  String err = lastCmdErr;

  String j; j.reserve(1320);
  j += "{\"ok\":true,\"fw\":\""; j += FW_VERSION;
  j += "\",\"dev\":\""; j += deviceId;
  j += "\",\"t\":"; j += (unsigned long)now;
  j += ",\"uptime\":"; j += (unsigned long)(now - bootMs);
  j += ",\"ip\":\""; j += (wifiStaOk ? WiFi.localIP().toString() : WiFi.softAPIP().toString());
  j += "\",\"clients\":"; j += clients;
  j += ",\"rssi\":"; j += (wifiStaOk ? WiFi.RSSI() : -127);
  j += ",\"heap\":"; j += (unsigned long)ESP.getFreeHeap();
  j += ",\"ready\":"; j += (ready ? "true" : "false");
  j += ",\"warm\":"; j += warmLeft;
  j += ",\"gasFault\":"; j += (gasFault ? "true" : "false");
  j += ",\"gasRaw\":"; j += gasRaw;
  j += ",\"gasFiltered\":"; j += gasFiltered;
  j += ",\"gasPpm\":"; j += gasPpm;
  j += ",\"gasBase\":"; j += gasBaseRaw;
  j += ",\"state\":\""; j += gasStateName(gasFault ? GAS_NORMAL : gasState);
  j += "\",\"gasWarn\":"; j += gasWarnPpm;
  j += ",\"gasDanger\":"; j += gasDangerPpm;
  j += ",\"gasHyst\":"; j += gasHyst;
  j += ",\"rainRaw\":"; j += rainRaw;
  j += ",\"rainFiltered\":"; j += rainFiltered;
  j += ",\"rainPct\":"; j += rainPct;
  j += ",\"rain\":"; j += (rainWet ? "true" : "false");
  j += ",\"flood\":"; j += (floodActive ? "true" : "false");
  j += ",\"rainWetPct\":"; j += rainWetPct;
  j += ",\"rainFloodPct\":"; j += rainFloodPct;
  j += ",\"rainInvert\":"; j += (rainInvert ? "true" : "false");
  j += ",\"rainOk\":"; j += (rainOk ? "true" : "false");
  j += ",\"vib\":"; j += (vibActive ? "true" : "false");
  j += ",\"vibRaw\":"; j += vibRaw;
  j += ",\"vibBase\":"; j += vibBase;
  j += ",\"vibDigital\":"; j += (vibDigital ? "true" : "false");
  j += ",\"vibEnabled\":"; j += (vibEnabled ? "true" : "false");
  j += ",\"vibAlarm\":"; j += (vibAlarm ? "true" : "false");
  j += ",\"vibDetected\":"; j += (vibConnected ? "true" : "false");
  j += ",\"vibUseDigital\":"; j += (vibUseDigital ? "true" : "false");
  j += ",\"vibUseAnalog\":"; j += (vibUseAnalog ? "true" : "false");
  j += ",\"vibTg\":"; j += (vibTg ? "true" : "false");
  j += ",\"flame\":"; j += (flameActive ? "true" : "false");
  j += ",\"flameRaw\":"; j += flameRaw;
  j += ",\"flameBase\":"; j += flameBase;
  j += ",\"flameDigital\":"; j += (flameDigital ? "true" : "false");
  j += ",\"flameEnabled\":"; j += (flameEnabled ? "true" : "false");
  j += ",\"flameAlarm\":"; j += (flameAlarm ? "true" : "false");
  j += ",\"flameDetected\":"; j += (flameConnected ? "true" : "false");
  j += ",\"flameUseDigital\":"; j += (flameUseDigital ? "true" : "false");
  j += ",\"flameUseAnalog\":"; j += (flameUseAnalog ? "true" : "false");
  j += ",\"flameTg\":"; j += (flameTg ? "true" : "false");
  j += ",\"sndMode\":\""; j += sndName(sndMode); j += "\"";
  j += ",\"sndVol\":"; j += sndVolume;
  j += ",\"sndManual\":"; j += (soundManual ? "true" : "false");
  j += ",\"sndReady\":"; j += (sndReady ? "true" : "false");
  j += ",\"fan\":"; j += (fanOn ? "true" : "false");
  j += ",\"pump\":"; j += (pumpOn ? "true" : "false");
  j += ",\"buzzer\":"; j += (buzzerOn ? "true" : "false");
  j += ",\"auto\":"; j += (autoControl ? "true" : "false");
  j += ",\"pumpLocked\":"; j += (gasState == GAS_DANGER ? "true" : "false");
  j += ",\"pumpLeft\":"; j += pumpLeft;
  j += ",\"window\":"; j += windowPos;
  j += ",\"blind\":"; j += blindPos;
  j += ",\"moving\":"; j += (moving ? "true" : "false");
  j += ",\"mqtt\":"; j += (mqttOnline ? "true" : "false");
  j += ",\"broker\":\""; j += (brokerFallback ? "yedek" : "birincil"); j += "\"";
  j += ",\"cmdId\":"; j += (unsigned long)lastCmdId;
  j += ",\"cmdErr\":\""; j += jsonEscape(err); j += "\"";
  j += ",\"tgOn\":"; j += (tgEnabled ? "true" : "false");
  j += ",\"tgTok\":"; j += (tgToken.length() ? "true" : "false");
  j += ",\"tgChat\":"; j += (tgChatId.length() ? "true" : "false");
  j += ",\"fs\":false,\"fsUsed\":0,\"fsTotal\":0}";
  return j;
}

static String buildSettingsJson() {
  String j; j.reserve(700);
  j += "{\"ok\":true,\"gasWarn\":"; j += gasWarnPpm;
  j += ",\"gasDanger\":"; j += gasDangerPpm;
  j += ",\"gasHyst\":"; j += gasHyst;
  j += ",\"rainWetPct\":"; j += rainWetPct;
  j += ",\"rainFloodPct\":"; j += rainFloodPct;
  j += ",\"rainInvert\":"; j += (rainInvert ? "true" : "false");
  j += ",\"autoControl\":"; j += (autoControl ? "true" : "false");
  j += ",\"vibEnabled\":"; j += (vibEnabled ? "true" : "false");
  j += ",\"vibAlarm\":"; j += (vibAlarm ? "true" : "false");
  j += ",\"vibUseDigital\":"; j += (vibUseDigital ? "true" : "false");
  j += ",\"vibUseAnalog\":"; j += (vibUseAnalog ? "true" : "false");
  j += ",\"vibTg\":"; j += (vibTg ? "true" : "false");
  j += ",\"flameEnabled\":"; j += (flameEnabled ? "true" : "false");
  j += ",\"flameAlarm\":"; j += (flameAlarm ? "true" : "false");
  j += ",\"flameUseDigital\":"; j += (flameUseDigital ? "true" : "false");
  j += ",\"flameUseAnalog\":"; j += (flameUseAnalog ? "true" : "false");
  j += ",\"flameTg\":"; j += (flameTg ? "true" : "false");
  j += ",\"sndVolume\":"; j += sndVolume;
  j += ",\"tgEnabled\":"; j += (tgEnabled ? "true" : "false");
  j += ",\"tgTokenSet\":"; j += (tgToken.length() ? "true" : "false");
  j += ",\"tgChatSet\":"; j += (tgChatId.length() ? "true" : "false");
  j += "}";
  return j;
}

static void publishStatus() {
  if (!mqttOnline) return;
  String s = buildStatus();
  mqttClient.publish(statusTopic().c_str(), s.c_str(), true);
  lastCmdErr = cmdErrHold;   // hata bir sonraki yayında görünür, sonra temizlenir
  cmdErrHold = "";
}

/* ------------------------------------------------------------- komutlar */
static String applyCommand(const String &device, const String &action, long value) {
  if (device == "fan") {
    if (action == "on")          setFan(true, false);
    else if (action == "off")    setFan(false, false);
    else if (action == "toggle") setFan(!fanOn, false);
    else return "gecersiz fan komutu";

  } else if (device == "pump") {
    if (gasState == GAS_DANGER && action != "off")
      return "gaz alarmi aktif, su motoru kilitli";
    if (action == "on")          setPump(true);
    else if (action == "off")    setPump(false);
    else if (action == "toggle") setPump(!pumpOn);
    else return "gecersiz pompa komutu";

  } else if (device == "buzzer" || device == "sound" || device == "speaker") {
    if (action == "on")          { soundManual = true;  setBuzzer(true); }
    else if (action == "off")    { soundManual = false; setBuzzer(false); }
    else if (action == "toggle") { soundManual = !buzzerOn; setBuzzer(soundManual); }
    else if (action == "test")   sndPlay(SND_TEST);
    else if (action == "siren")  sndPlay(SND_SIREN);
    else if (action == "beep")   sndPlay(SND_BEEP);
    else if (action == "set" || action == "volume") {
      if (value < 0) value = 0;
      if (value > 100) value = 100;
      sndVolume = (int)value;
      saveSettings();
    }
    else return "gecersiz ses komutu";

  } else if (device == "vibration" || device == "vib") {
    if (action == "on")           vibEnabled = true;
    else if (action == "off")     vibEnabled = false;
    else if (action == "toggle")  vibEnabled = !vibEnabled;
    else if (action == "alarm")   vibAlarm = true;
    else if (action == "noalarm") vibAlarm = false;
    else if (action == "clear")   { vibActive = false; vibHoldUntilMs = 0; }
    else if (action == "test")    { vibHoldUntilMs = millis() + VIB_TRIGGER_HOLD_MS; vibConnected = true; }
    else return "gecersiz titresim komutu";
    saveSettings();

  } else if (device == "flame" || device == "fire") {
    if (action == "on")           flameEnabled = true;
    else if (action == "off")     flameEnabled = false;
    else if (action == "toggle")  flameEnabled = !flameEnabled;
    else if (action == "alarm")   flameAlarm = true;
    else if (action == "noalarm") flameAlarm = false;
    else if (action == "clear")   { flameActive = false; flameHoldUntilMs = 0; }
    else if (action == "test")    { flameHoldUntilMs = millis() + FLAME_TRIGGER_HOLD_MS; flameConnected = true; }
    else return "gecersiz alev komutu";
    saveSettings();

  } else if (device == "window") {
    if (action == "open")       setWindow(SERVO_WINDOW_OPEN);
    else if (action == "shut")  setWindow(SERVO_WINDOW_SHUT);
    else if (action == "ajar")  setWindow(SERVO_WINDOW_AJAR);
    else if (action == "set" || action == "angle") setWindow((int)value);
    else if (action == "stop")  servoRelease(PIN_SERVO_WINDOW, LEDC_CH_WINDOW);
    else if (value >= 0 && value <= 180) setWindow((int)value);
    else return "gecersiz pencere komutu";

  } else if (device == "blind") {
    if (action == "open")       setBlind(SERVO_BLIND_OPEN);
    else if (action == "shut")  setBlind(SERVO_BLIND_SHUT);
    else if (action == "set" || action == "angle") setBlind((int)value);
    else if (action == "stop")  servoRelease(PIN_SERVO_BLIND, LEDC_CH_BLIND);
    else if (value >= 0 && value <= 180) setBlind((int)value);
    else return "gecersiz panjur komutu";

  } else if (device == "auto") {
    if (action == "on")          autoControl = true;
    else if (action == "off")    autoControl = false;
    else if (action == "toggle") autoControl = !autoControl;
    else return "gecersiz oto komutu";
    saveSettings();
    if (!autoControl && gasState != GAS_DANGER) { wasRainShut = false; setWindow(SERVO_WINDOW_OPEN); }

  } else if (device == "gas") {
    if (action == "recalibrate") {
      calibrateGasBaseline();     // panel isteğiyle temiz hava tabanını yeniden ölç
      gasBaseStable = true;
      Serial.print(F("[mq2] panel istegiyle taban yeniden olculdu=")); Serial.println(gasBaseRaw);
    } else return "bilinmeyen gaz aksiyonu";

  } else if (device == "test") {
    if (action == "simulate_alarm") {
      alarmSimUntilMs = millis() + 5000;
      gasState = GAS_DANGER;
      runAutomation();
      Serial.println(F("[test] 5 saniyelik alarm simulasyonu"));
    } else return "bilinmeyen test aksiyonu";

  } else if (device == "reboot") {
    rebootAtMs = millis() + 400;
    return "";

  } else {
    return "bilinmeyen cihaz";
  }
  return "";
}

static String applySettingsJson(const String &body) {
  long warn = gasWarnPpm, danger = gasDangerPpm, hyst = gasHyst;
  long rw = rainWetPct, rf = rainFloodPct;
  bool invert = rainInvert, autc = autoControl, tgen = tgEnabled;
  bool vibEn = vibEnabled, vibAl = vibAlarm, vibDig = vibUseDigital, vibAna = vibUseAnalog, vibTelegram = vibTg;
  bool flmEn = flameEnabled, flmAl = flameAlarm, flmDig = flameUseDigital, flmAna = flameUseAnalog, flmTelegram = flameTg;
  long sndVol = sndVolume;
  bool ttest = false, forgetTok = false, forgetChat = false;
  String token = "", chat = "";

  jsonGetNum(body, "gasWarn", warn);
  jsonGetNum(body, "gasDanger", danger);
  jsonGetNum(body, "gasHyst", hyst);
  jsonGetNum(body, "rainWetPct", rw);
  jsonGetNum(body, "rainFloodPct", rf);
  jsonGetBool(body, "rainInvert", invert);
  jsonGetBool(body, "autoControl", autc);
  jsonGetBool(body, "vibEnabled", vibEn);
  jsonGetBool(body, "vibAlarm", vibAl);
  jsonGetBool(body, "vibUseDigital", vibDig);
  jsonGetBool(body, "vibUseAnalog", vibAna);
  jsonGetBool(body, "vibTg", vibTelegram);
  jsonGetBool(body, "flameEnabled", flmEn);
  jsonGetBool(body, "flameAlarm", flmAl);
  jsonGetBool(body, "flameUseDigital", flmDig);
  jsonGetBool(body, "flameUseAnalog", flmAna);
  jsonGetBool(body, "flameTg", flmTelegram);
  jsonGetNum(body, "sndVolume", sndVol);
  jsonGetBool(body, "tgEnabled", tgen);
  jsonGetStr(body, "tgToken", token);
  jsonGetStr(body, "tgChatId", chat);
  jsonGetBool(body, "tgTest", ttest);
  jsonGetBool(body, "tgForgetToken", forgetTok);
  jsonGetBool(body, "tgForgetChat", forgetChat);

  if (warn <= 0 || danger <= 0 || warn >= danger)
    return "gecersiz esik degerleri (gasWarn < gasDanger olmali)";
  if (hyst < 0 || hyst >= warn) return "gecersiz histerezis";
  if (rw < 1 || rw > 100 || rf < 1 || rf > 100 || rf <= rw)
    return "gecersiz yagmur esikleri (rainWetPct < rainFloodPct olmali)";

  gasWarnPpm   = (int)warn;
  gasDangerPpm = (int)danger;
  gasHyst      = (int)hyst;
  rainWetPct   = (int)rw;
  rainFloodPct = (int)rf;
  rainInvert   = invert;
  autoControl  = autc;
  vibEnabled   = vibEn;
  vibAlarm     = vibAl;
  vibUseDigital= vibDig;
  vibUseAnalog = vibAna;
  vibTg        = vibTelegram;
  flameEnabled = flmEn;
  flameAlarm   = flmAl;
  flameUseDigital = flmDig;
  flameUseAnalog  = flmAna;
  flameTg      = flmTelegram;
  if (sndVol < 0) sndVol = 0;
  if (sndVol > 100) sndVol = 100;
  sndVolume    = (int)sndVol;
  tgEnabled    = tgen;
  if (forgetTok) tgToken = "";
  else if (token.length()) tgToken = token;
  if (forgetChat) tgChatId = "";
  else if (chat.length()) tgChatId = chat;
  saveSettings();

  if (ttest) tgSend("Deneyap Ev Koruma: test bildirimi basarili.", true);
  return "";
}

/* --------------------------------------------------------------- MQTT */
static void mqttCallback(char *topic, byte *payload, unsigned int length) {
  String t(topic);
  String body;
  body.reserve(length + 1);
  for (unsigned int i = 0; i < length; i++) body += (char)payload[i];
  String base = baseTopic();

  if (t == base + "/cmd") {
    String device, action; long value = 0;
    long id = 0;
    jsonGetNum(body, "id", id);
    if (!jsonGetStr(body, "device", device) || !jsonGetStr(body, "action", action)) {
      Serial.println(F("[mqtt] gecersiz cmd govdesi"));
      return;
    }
    jsonGetNum(body, "value", value);
    String err = applyCommand(device, action, value);
    lastCmdId = (uint32_t)id;
    lastCmdErr = err;
    cmdErrHold = err;
    Serial.print(F("[mqtt] cmd ")); Serial.print(device); Serial.print(F(" -> "));
    Serial.println(action);
    publishStatus();

  } else if (t == base + "/settings") {
    String err = applySettingsJson(body);
    if (err.length()) { lastCmdErr = err; cmdErrHold = err; Serial.print(F("[mqtt] ayar reddi: ")); Serial.println(err); }
    else { lastCmdErr = ""; cmdErrHold = ""; }
    publishStatus();

  } else if (t == base + "/histreq") {
    long id = 0, n = 140, last = 0;
    jsonGetNum(body, "id", id);
    jsonGetNum(body, "n", n);
    jsonGetNum(body, "last", last);
    String h = buildHistJson(id, n, last);
    mqttClient.publish((base + "/hist").c_str(), h.c_str(), false);
  }
}

static void mqttConnect() {
  if (wifiStaOk == false && apActive == false) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if (mqttClient.connected()) return;

  /* Birincil / yedek broker seçimi (yedekteyken birincil yoklaması loop'ta
     ayrıca yapılır; burada yalnızca akım hedef bağlanır). */
  const char *host; uint16_t port; const char *label;
  if (brokerFallback) { host = MQTT_HOST_FALLBACK; port = MQTT_PORT_FALLBACK; label = "yedek"; }
  else                { host = MQTT_HOST;         port = MQTT_PORT;         label = "birincil"; }

  mqttClient.setServer(host, port);
  String clientId = String(deviceId) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  String willTopic = baseTopic() + "/online";
  bool ok = (strlen(MQTT_USER) > 0)
    ? mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS,
                         willTopic.c_str(), 0, true, "offline")
    : mqttClient.connect(clientId.c_str(), nullptr, nullptr,
                         willTopic.c_str(), 0, true, "offline");
  if (ok) {
    mqttOnline = true;
    mqttFailStreak = 0;
    mqttBackoffMs = MQTT_RETRY_MIN;
    mqttClient.publish(willTopic.c_str(), "online", true);
    String base = baseTopic();
    mqttClient.subscribe((base + "/cmd").c_str(), 0);
    mqttClient.subscribe((base + "/settings").c_str(), 0);
    mqttClient.subscribe((base + "/histreq").c_str(), 0);
    Serial.print(F("[mqtt] baglandi: ")); Serial.print(host);
    Serial.print(F("  konu: ")); Serial.println(base);
    Serial.print(F("[mqtt] broker: ")); Serial.println(label);
    publishStatus();
  } else {
    mqttOnline = false;
    mqttFailStreak++;
    Serial.print(F("[mqtt] baglanti basarisiz, durum=")); Serial.println(mqttClient.state());

    /* Birincil üst üste başarısızsa yedeğe geç. Yedekteyken de birincili
       zaman zaman yokla ki düzelince kendiliğinden geri dönsün (düşmüş
       bağlantı zaten loop'ta yeniden kurulur). */
    if (!brokerFallback && mqttFailStreak >= MQTT_FAILOVER_AFTER) {
      brokerFallback = true;
      mqttFailStreak = 0;
      mqttBackoffMs = MQTT_RETRY_MIN;   // yedeği hızlı dene (geri çekilmeyi sıfırla)
      mqttPrimaryProbeAt = millis() + MQTT_PRIMARY_PROBE_MS;
      Serial.println(F("[mqtt] birincil broker erisilemiyor -> yedek deneniyor"));
    } else if (brokerFallback && (int32_t)(millis() - mqttPrimaryProbeAt) >= 0) {
      brokerFallback = false;   // sonraki deneme birincile gidecek
      mqttFailStreak = 0;
      Serial.println(F("[mqtt] birincil broker yeniden deneniyor"));
    }
  }
}

/* --------------------------------------------------------- HTTP sunucusu */
static bool httpAuthorize() {
  if (strlen(API_TOKEN) == 0) return true;
  if (server.header("X-Auth-Token") == API_TOKEN) return true;
  if (server.arg("token") == API_TOKEN) return true;
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(401, "application/json; charset=utf-8", "{\"ok\":false,\"error\":\"unauthorized\"}");
  return false;
}
static void jsonResp(const String &body, int code) {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-store");
  server.send(code, "application/json; charset=utf-8", body);
}
static void handleStatus() { jsonResp(buildStatus(), 200); }

static void handleControlPost() {
  if (!httpAuthorize()) return;
  String body = server.arg("plain");
  String device, action; long value = 0;
  if (!jsonGetStr(body, "device", device) || !jsonGetStr(body, "action", action)) {
    jsonResp("{\"ok\":false,\"error\":\"gecersiz govde (device/action bekleniyor)\"}", 400);
    return;
  }
  jsonGetNum(body, "value", value);
  String err = applyCommand(device, action, value);
  if (err.length()) { lastCmdErr = err; jsonResp(String("{\"ok\":false,\"error\":\"") + jsonEscape(err) + "\"}", 400); return; }
  lastCmdErr = "";
  jsonResp(buildStatus(), 200);
}
static void handleControlGet() {
  if (!httpAuthorize()) return;
  String device = server.arg("device");
  String action = server.arg("action");
  long value = server.arg("value").toInt();
  if (device.length() == 0 || action.length() == 0) { jsonResp("{\"ok\":false,\"error\":\"device & action gerekli\"}", 400); return; }
  String err = applyCommand(device, action, value);
  if (err.length()) { lastCmdErr = err; jsonResp(String("{\"ok\":false,\"error\":\"") + jsonEscape(err) + "\"}", 400); return; }
  lastCmdErr = "";
  jsonResp(buildStatus(), 200);
}
static void handleSettingsPost() {
  if (!httpAuthorize()) return;
  String err = applySettingsJson(server.arg("plain"));
  if (err.length()) { jsonResp(String("{\"ok\":false,\"error\":\"") + jsonEscape(err) + "\"}", 400); return; }
  jsonResp(buildSettingsJson(), 200);
}
static void handleSettingsGet() {
  if (!httpAuthorize()) return;
  jsonResp(buildSettingsJson(), 200);
}
static void handleHistory() {
  if (!httpAuthorize()) return;
  long n = server.hasArg("n") ? server.arg("n").toInt() : 140;
  long last = server.hasArg("last") ? server.arg("last").toInt() : 0;
  jsonResp(buildHistJson(0, n, last), 200);
}
static void handleOptions() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, X-Auth-Token");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.send(204, "text/plain", "");
}
static void handleRoot() {
  String html = F("<!DOCTYPE html><html lang=\"tr\"><head><meta charset=\"UTF-8\">"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    "<title>Deneyap Ev Koruma</title>"
    "<style>body{background:#121212;color:#f1f1f1;font:16px/1.6 system-ui,sans-serif;padding:2rem}"
    "a{color:#3794ff}code{background:#000;padding:.15rem .4rem;border-radius:4px;color:#ffb829}</style></head><body>"
    "<h1>Deneyap Ev Koruma v" FW_VERSION "</h1>"
    "<p>Cihaz calisiyor. MQTT durumu: <b id=\"m\">-</b></p>"
    "<p>HTTP API: <a href=\"/api/status\">/api/status</a> &middot; "
    "<a href=\"/api/settings\">/api/settings</a> &middot; "
    "<a href=\"/api/history\">/api/history</a></p>"
    "<p>Panel (PWA) Vercel uzerinde oldugu icin asil iletisim MQTT konusundadir: "
    "<code>" MQTT_TOPIC "</code></p></body></html>");
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "text/html; charset=utf-8", html);
}
static void setupRoutes() {
  server.on("/",               HTTP_GET,     handleRoot);
  server.on("/api/status",     HTTP_GET,     handleStatus);
  server.on("/api/control",    HTTP_POST,    handleControlPost);
  server.on("/api/control",    HTTP_GET,     handleControlGet);
  server.on("/api/settings",   HTTP_POST,    handleSettingsPost);
  server.on("/api/settings",   HTTP_GET,     handleSettingsGet);
  server.on("/api/history",    HTTP_GET,     handleHistory);
  server.on("/api/status",     HTTP_OPTIONS, handleOptions);
  server.on("/api/control",    HTTP_OPTIONS, handleOptions);
  server.on("/api/settings",   HTTP_OPTIONS, handleOptions);
  server.on("/api/history",    HTTP_OPTIONS, handleOptions);
}

/* ------------------------------------------------------------------ WiFi */
static void connectWiFi() {
  Serial.print(F("[wifi] STA baglaniyor: ")); Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  /* Marjinal USB beslemede TX tepe akımını düşür (brownout reseti önlemi):
     8.5 dBm (~35 mW), ev içi mesafeler için yeterli. */
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && !timeReached(millis(), start, WIFI_CONNECT_MS)) {
    delay(250);
    Serial.print('.');
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiStaOk = true;
    apActive  = false;
    Serial.println();
    Serial.print(F("[wifi] bagli. IP: ")); Serial.println(WiFi.localIP());
  } else {
    wifiStaOk = false;
    apActive  = true;
    WiFi.mode(WIFI_AP);
    WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1), IPAddress(255, 255, 255, 0));
    bool ap = WiFi.softAP(AP_SSID, AP_PASSWORD, AP_CHANNEL, AP_HIDDEN, AP_MAX_CLIENTS);
    if (!ap) ap = WiFi.softAP(AP_SSID);
    Serial.println();
    Serial.print(F("[wifi] STA basarisiz -> AP: ")); Serial.print(AP_SSID);
    Serial.print(F("  http://")); Serial.println(WiFi.softAPIP());
  }
}

/* ----------------------------------------------------------------- setup */
void setup() {
  /* USB beslemesi marjinalken Wi-Fi TX ani akımı voltajı brownout eşiğine
     çekiyor ve kart sürekli resetleniyordu. Detektörü kapatıyoruz; tepe akımı
     için TX gücü ayrıca connectWiFi() içinde düşürülür.
     (Derin/gerçek yetersayı koruması kalkar ama kısmi voltaj düşüşü kartı
     öldürmez; buna karşı TX gücü + güç kaynağı önerisi README'de.) */
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  delay(200);
  bootMs = millis();
  Serial.println();
  Serial.println(F("=== Deneyap Ev Koruma v" FW_VERSION " (MQTT) ==="));

  if (PIN_LED >= 0) { pinMode(PIN_LED, OUTPUT); digitalWrite(PIN_LED, LOW); }

  analogReadResolution(10);

  loadSettings();
  makeDeviceId();

  pinMode(PIN_RELAY_FAN, OUTPUT);  digitalWrite(PIN_RELAY_FAN, LOW);
  pinMode(PIN_RELAY_PUMP, OUTPUT); digitalWrite(PIN_RELAY_PUMP, LOW);
#if PIN_BUZZER >= 0
  pinMode(PIN_BUZZER, OUTPUT);     digitalWrite(PIN_BUZZER, LOW);
#endif
  pinMode(PIN_MQ2, INPUT);
  pinMode(PIN_RAIN, INPUT);
  if (PIN_VIB_AO >= 0) pinMode(PIN_VIB_AO, INPUT);
  if (PIN_VIB_DO >= 0) pinMode(PIN_VIB_DO, INPUT_PULLUP);   // LM393 açık kolektör
  if (PIN_FLAME_AO >= 0) pinMode(PIN_FLAME_AO, INPUT);
  if (PIN_FLAME_DO >= 0) pinMode(PIN_FLAME_DO, INPUT_PULLUP); // LM393 açık kolektör
  outputsSafe("acilis");

  /* I2S hoparlör (MAX98357A) + ses görevi */
  i2sInit();
  audioStart();

  /* Servo başlangıç konumları, sonra motorları serbest bırak */
  setWindow(SERVO_WINDOW_OPEN);
  setBlind(SERVO_BLIND_SHUT);
  servoRelease(PIN_SERVO_WINDOW, LEDC_CH_WINDOW);
  servoRelease(PIN_SERVO_BLIND, LEDC_CH_BLIND);

  /* Gaz tabanı ölçümü + ısınma penceresi */
  calibrateGasBaseline();
  warmUpUntilMs = millis() + GAS_WARMUP_MS;

  connectWiFi();

  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(MQTT_BUFFER_SIZE);
  mqttClient.setKeepAlive(30);

  setupRoutes();
  server.begin();
  Serial.println(F("[http] sunucu hazir"));

  mqttConnect();
  historyPush();   // ilk örnek
}

/* ------------------------------------------------------------------ loop */
void loop() {
  uint32_t now = millis();

  /* Yeniden başlatma isteği (komut üzerinden) */
  if (rebootAtMs && (int32_t)(now - rebootAtMs) >= 0) {
    Serial.println(F("[sistem] yeniden baslatiliyor"));
    delay(100);
    ESP.restart();
  }

  /* Wi-Fi yeniden bağlanma (STA düştüyse) */
  if (!apActive && WiFi.status() != WL_CONNECTED) {
    if (wifiStaOk) { wifiStaOk = false; mqttOnline = false; Serial.println(F("[wifi] baglanti koptu")); }
    if (timeReached(now, wifiRetryAt, 5000)) {
      wifiRetryAt = now;
      WiFi.reconnect();
    }
  } else if (!apActive && WiFi.status() == WL_CONNECTED && !wifiStaOk) {
    wifiStaOk = true;
    Serial.print(F("[wifi] yeniden bagli. IP: ")); Serial.println(WiFi.localIP());
  }

  /* MQTT bağlantısı: kesikse üstel geri çekilmeyle yeniden dene (3 s -> 60 s
     tavan); herhangi bir broker'a bağlanamıyorsak emqx'i de yoklayarak tahammül
     etme. Yedek broker'a bağlıyken birincili zaman zaman yoklarız ki düzelince
     kart-panel aynı broker'da buluşsun. */
  if (wifiStaOk && WiFi.status() == WL_CONNECTED) {
    if (mqttClient.connected() && brokerFallback && (int32_t)(now - mqttPrimaryProbeAt) >= 0) {
      mqttPrimaryProbeAt = now + MQTT_PRIMARY_PROBE_MS;
      Serial.println(F("[mqtt] yedekteyken birincil broker yoklaniyor"));
      mqttClient.disconnect();               // akım bağlantıyı bırak; yeniden bağlanma birincili dener
      brokerFallback = false;
      mqttFailStreak = 0;
    }
    if (!mqttClient.connected()) {
      mqttOnline = false;
      if (timeReached(now, mqttRetryAt, mqttBackoffMs)) {
        mqttRetryAt = now;
        mqttConnect();
        if (!mqttClient.connected() && mqttBackoffMs < MQTT_RETRY_MAX) {
          mqttBackoffMs *= 2;                 // başarısızsa bekleme süresini artır
          if (mqttBackoffMs > MQTT_RETRY_MAX) mqttBackoffMs = MQTT_RETRY_MAX;
        }
      }
    }
    mqttClient.loop();
  }

  server.handleClient();

  /* Sensör + otomasyon */
  if (timeReached(now, lastSensorMs, SENSOR_INTERVAL_MS)) {
    lastSensorMs = now;
    GasState before = gasState;
    bool floodBefore = floodActive;
    readSensors();
    runAutomation();

    if (before != GAS_DANGER && gasState == GAS_DANGER) {
      tgSend(String("GAZ TEHLIKESI! ") + gasPpm + " ppm. Fan calistirildi, pencere kapatildi.", false);
      pushNotify("gas");
    }
    if (!floodBefore && floodActive) {
      tgSend(String("SU BASKINI! Islaklik %") + rainPct + ". Pencere kapatildi.", false);
      pushNotify("flood");
    }
  }

  /* Isınma penceresi bitince tabanı yeniden ölç: açılıştaki soğuk spike
     (örnekler 1023'e yakınken ölçülen taban) span'i çökertip tüm oturumu
     -10000 ppm'e kilitleyebiliyordu. İlk ölçüm yalnızca ön bilgi; asıl
     taban burada oturmuş sensör üzerinden bir kez daha alınır. */
  if (!gasBaseStable && (int32_t)(now - warmUpUntilMs) >= 0) {
    calibrateGasBaseline();
    gasBaseStable = true;
    historyPush();    // taban değişince geçmiş kaydını da tazele
    publishStatus();
    Serial.println(F("[mq2] isinma bitti, taban yeniden olculdu -> HAZIR"));
  }

  /* Su motoru taşma koruması */
  if (pumpOn && timeReached(now, pumpStartedMs, PUMP_MAX_RUN_MS)) {
    Serial.println(F("[guvenlik] su motoru azami sureyi asti, kapatildi"));
    setPump(false);
  }

  /* Servo hareketi bitince motorları serbest bırak */
  if (servoReleaseAt != 0 && (int32_t)(now - servoReleaseAt) >= 0) {
    servoRelease(PIN_SERVO_WINDOW, LEDC_CH_WINDOW);
    servoRelease(PIN_SERVO_BLIND, LEDC_CH_BLIND);
  }

  /* Geçmiş örnekleme */
  if (timeReached(now, lastHistMs, HISTORY_STEP_MS)) {
    lastHistMs = now;
    historyPush();
  }

  /* Durum yayını (MQTT) */
  if (timeReached(now, lastStatusMs, MQTT_STATUS_MS)) {
    lastStatusMs = now;
    publishStatus();
  }

  /* Durum LED'i: tehlike = yanıp söner, oto = açık */
  if (PIN_LED >= 0) {
    digitalWrite(PIN_LED, (gasState == GAS_DANGER) ? ((now / 200) % 2) : (autoControl ? HIGH : LOW));
  }

  /* Seri monitör raporu */
  if (timeReached(now, lastReportMs, SERIAL_REPORT_MS)) {
    lastReportMs = now;
    Serial.print(F("gaz: ")); Serial.print(gasPpm);
    Serial.print(F(" ppm (flt ")); Serial.print(gasFiltered);
    Serial.print(F(" ham ")); Serial.print(gasRaw);
    Serial.print(F(")  yagmur: %")); Serial.print(rainPct);
    Serial.print(rainWet ? " ISLAK" : " KURU");
    Serial.print(F("  titresim: ")); Serial.print(vibActive ? "VAR" : "yok");
    Serial.print(F(" (AO ")); Serial.print(vibRaw);
    Serial.print(F(" / DO ")); Serial.print(vibDigital ? "1" : "0"); Serial.print(')');
    Serial.print(F("  durum: ")); Serial.print(gasStateName(gasState));
    Serial.print(F("  fan: ")); Serial.print(fanOn ? "ACIK" : "KAPALI");
    Serial.print(F("  pompa: ")); Serial.print(pumpOn ? "ACIK" : "KAPALI");
    Serial.print(F("  mqtt: ")); Serial.print(mqttOnline ? "BAGLI" : "YOK");
    Serial.print(F("  heap: ")); Serial.print(ESP.getFreeHeap());
    Serial.println(F(" B"));
  }
}
