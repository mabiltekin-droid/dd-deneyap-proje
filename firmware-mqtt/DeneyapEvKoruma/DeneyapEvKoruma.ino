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
 *    WiFi, WebServer, Servo, Preferences, LittleFS, HTTPClient, WiFiClientSecure
 * ============================================================================
 */

#include <WiFi.h>
#include <WebServer.h>
#include <PubSubClient.h>
#include <Servo.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

#include "config.h"

/* ------------------------------------------------------------------ durum */
enum GasState : uint8_t { GAS_NORMAL = 0, GAS_WARN = 1, GAS_DANGER = 2 };

WiFiClient        netClient;
PubSubClient      mqttClient(netClient);
WebServer         server(80);
Servo             servoWindow;
Servo             servoBlind;
Preferences       prefs;

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
bool              floodRaw      = false;
bool              floodActive   = false;
uint32_t          floodStartMs  = 0;
uint32_t          warmUpUntilMs = 0;
bool              firstRead     = true;
GasState          gasState      = GAS_NORMAL;

/* Çıkışlar */
bool              fanOn           = false;
bool              pumpOn          = false;
bool              buzzerOn        = false;
bool              fanByAutomation = false;
bool              wasDanger       = false;
bool              wasRainShut     = false;
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

/* MQTT yanıt durumu */
uint32_t          lastCmdId       = 0;
String            lastCmdErr      = "";
String            cmdErrHold      = "";   // bir sonraki yayına kadar tutulur

/* Geçmiş halka tamponu (RAM) */
struct HistRec { uint32_t t; uint16_t ppm; uint8_t rain; uint8_t st; uint8_t fl; };
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
  tgEnabled    = prefs.getBool("tgEnabled", TG_ENABLED_DEFAULT);
  tgToken      = prefs.getString("tgToken", "");
  tgChatId     = prefs.getString("tgChat", "");
  prefs.end();

  if (gasWarnPpm <= 0) gasWarnPpm = GAS_WARN_PPM;
  if (gasDangerPpm <= gasWarnPpm) gasDangerPpm = GAS_DANGER_PPM;
  if (gasHyst < 0 || gasHyst >= gasWarnPpm) gasHyst = GAS_HYSTERESIS;
  if (rainWetPct < 1 || rainWetPct > 100) rainWetPct = RAIN_WET_PCT;
  if (rainFloodPct <= rainWetPct || rainFloodPct > 100) rainFloodPct = RAIN_FLOOD_PCT;
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
  digitalWrite(PIN_BUZZER, LOW);
  fanOn = pumpOn = buzzerOn = false;
  fanByAutomation = false;
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
  digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
  buzzerOn = on;
}
static void servoRelease(Servo &s, int pin) {
  s.detach();
  pinMode(pin, INPUT);
  servoReleaseAt = 0;
}
static void setWindow(int angle) {
  if (angle < 0)   angle = 0;
  if (angle > 180) angle = 180;
  servoWindow.attach(PIN_SERVO_WINDOW);
  pinMode(PIN_SERVO_WINDOW, OUTPUT);
  servoWindow.write(angle);
  windowPos = angle;
  servoReleaseAt = millis() + SERVO_MOVE_MS;
  Serial.print(F("[servo] pencere -> ")); Serial.println(angle);
}
static void setBlind(int angle) {
  if (angle < 0)   angle = 0;
  if (angle > 180) angle = 180;
  servoBlind.attach(PIN_SERVO_BLIND);
  pinMode(PIN_SERVO_BLIND, OUTPUT);
  servoBlind.write(angle);
  blindPos = angle;
  servoReleaseAt = millis() + SERVO_MOVE_MS;
  Serial.print(F("[servo] panjur -> ")); Serial.println(angle);
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
  gasEma = (float)gasBaseRaw;
  gasFiltered = gasBaseRaw;
  Serial.print(F("[mq2] temiz hava tabani=")); Serial.println(gasBaseRaw);
}

static void readSensors() {
  gasRaw  = analogRead(PIN_MQ2);
  rainRaw = analogRead(PIN_RAIN);

  if (firstRead) { gasEma = gasRaw; rainEma = rainRaw; firstRead = false; }
  else {
    gasEma  = (SENSOR_EMA_ALPHA * gasRaw)  + ((1.0f - SENSOR_EMA_ALPHA) * gasEma);
    rainEma = (SENSOR_EMA_ALPHA * rainRaw) + ((1.0f - SENSOR_EMA_ALPHA) * rainEma);
  }
  gasFiltered  = (int)(gasEma + 0.5f);
  rainFiltered = (int)(rainEma + 0.5f);

  /* Gaz sensörü arıza tespiti (kopuk / kısa devre) */
  gasFault = (gasRaw <= GAS_FAULT_LOW) || (gasRaw >= GAS_FAULT_HIGH);

  /* Ham ADC -> PPM (doğrusal model) */
  if (gasBaseRaw < GAS_BASE_MIN) gasBaseRaw = 200;
  float span = ADC_FULL_SCALE - (float)gasBaseRaw;
  if (span <= 0) span = 1.0f;
  float ppm = ((float)gasFiltered - (float)gasBaseRaw) * (GAS_PPM_FULL_SCALE / span);
  gasPpm = (ppm < 0) ? 0 : (int)(ppm + 0.5f);
  if (gasPpm > (int)GAS_PPM_FULL_SCALE) gasPpm = (int)GAS_PPM_FULL_SCALE;

  /* Yağmur: ıslaklık yüzdesi 0..100 */
  int wetness = rainInvert ? (1023 - rainFiltered) : rainFiltered;
  if (wetness < 0) wetness = 0;
  if (wetness > 1023) wetness = 1023;
  rainPct = (int)((long)wetness * 100 / 1023);
  rainWet = rainPct >= rainWetPct;

  /* Su baskını: eşik üstünde FLOOD_HOLD_MS boyunca kalırsa kalıcı say */
  floodRaw = rainPct >= rainFloodPct;
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

  /* 1) Gaz tehlikesi (en yüksek öncelik) */
  if (gasState == GAS_DANGER) {
    setBuzzer(true);
    setFan(true, true);
    setPump(false);
    if (autoControl && !wasDanger) setWindow(SERVO_WINDOW_SHUT);
    wasDanger = true;
    return;
  }
  setBuzzer(false);

  if (fanByAutomation && timeReached(now, fanLatchedMs, FAN_AUTO_OFF_MS)) setFan(false, false);

  if (wasDanger && gasState != GAS_DANGER) {
    wasDanger = false;
    if (autoControl) {
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

/* --------------------------------------------------------------- geçmiş */
static int histIndex(int i) {
  int start = ((int)histHead - (int)histCount + HISTORY_MAX) % HISTORY_MAX;
  return (start + i) % HISTORY_MAX;
}
static void historyPush() {
  HistRec &r = hist[histHead];
  r.t = (uint32_t)((millis() - bootMs) / 1000UL);
  r.ppm = (uint16_t)(gasPpm > 65000 ? 65000 : gasPpm);
  r.rain = (uint8_t)(rainPct < 0 ? 0 : (rainPct > 100 ? 100 : rainPct));
  r.st = (uint8_t)(gasFault ? 3 : (uint8_t)gasState);
  uint8_t fl = 0;
  if (fanOn)             fl |= 1;
  if (pumpOn)            fl |= 2;
  if (buzzerOn)          fl |= 4;
  if (windowPos > 150)   fl |= 8;
  if (blindPos > 30)     fl |= 16;
  if (floodActive)       fl |= 32;
  if (autoControl)       fl |= 64;
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
static String buildStatus() {
  uint32_t now = millis();
  bool moving  = (int32_t)(servoReleaseAt - now) > 0;
  int  warmLeft = 0;
  if ((int32_t)(warmUpUntilMs - now) > 0) warmLeft = (int)((warmUpUntilMs - now) / 1000UL);
  bool ready = warmLeft == 0;
  long pumpLeft = 0;
  if (pumpOn && pumpStartedMs) {
    long e = (long)(now - pumpStartedMs);
    pumpLeft = (e < (long)PUMP_MAX_RUN_MS) ? ((long)PUMP_MAX_RUN_MS - e) : 0;
  }
  int clients = apActive ? (int)WiFi.softAPgetStationNum() : (wifiStaOk ? 1 : 0);
  String err = lastCmdErr;

  String j; j.reserve(900);
  j += "{\"ok\":true,\"fw\":\""; j += FW_VERSION;
  j += "\",\"dev\":\""; j += DEVICE_ID;
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
  j += ",\"cmdId\":"; j += (unsigned long)lastCmdId;
  j += ",\"cmdErr\":\""; j += jsonEscape(err); j += "\"";
  j += ",\"tgOn\":"; j += (tgEnabled ? "true" : "false");
  j += ",\"tgTok\":"; j += (tgToken.length() ? "true" : "false");
  j += ",\"tgChat\":"; j += (tgChatId.length() ? "true" : "false");
  j += ",\"fs\":false,\"fsUsed\":0,\"fsTotal\":0}";
  return j;
}

static String buildSettingsJson() {
  String j; j.reserve(280);
  j += "{\"ok\":true,\"gasWarn\":"; j += gasWarnPpm;
  j += ",\"gasDanger\":"; j += gasDangerPpm;
  j += ",\"gasHyst\":"; j += gasHyst;
  j += ",\"rainWetPct\":"; j += rainWetPct;
  j += ",\"rainFloodPct\":"; j += rainFloodPct;
  j += ",\"rainInvert\":"; j += (rainInvert ? "true" : "false");
  j += ",\"autoControl\":"; j += (autoControl ? "true" : "false");
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

  } else if (device == "buzzer") {
    if (action == "on")          setBuzzer(true);
    else if (action == "off")    setBuzzer(false);
    else if (action == "toggle") setBuzzer(!buzzerOn);
    else return "gecersiz buzzer komutu";

  } else if (device == "window") {
    if (action == "open")       setWindow(SERVO_WINDOW_OPEN);
    else if (action == "shut")  setWindow(SERVO_WINDOW_SHUT);
    else if (action == "ajar")  setWindow(SERVO_WINDOW_AJAR);
    else if (action == "set" || action == "angle") setWindow((int)value);
    else if (action == "stop")  servoRelease(servoWindow, PIN_SERVO_WINDOW);
    else if (value >= 0 && value <= 180) setWindow((int)value);
    else return "gecersiz pencere komutu";

  } else if (device == "blind") {
    if (action == "open")       setBlind(SERVO_BLIND_OPEN);
    else if (action == "shut")  setBlind(SERVO_BLIND_SHUT);
    else if (action == "set" || action == "angle") setBlind((int)value);
    else if (action == "stop")  servoRelease(servoBlind, PIN_SERVO_BLIND);
    else if (value >= 0 && value <= 180) setBlind((int)value);
    else return "gecersiz panjur komutu";

  } else if (device == "auto") {
    if (action == "on")          autoControl = true;
    else if (action == "off")    autoControl = false;
    else if (action == "toggle") autoControl = !autoControl;
    else return "gecersiz oto komutu";
    saveSettings();
    if (!autoControl && gasState != GAS_DANGER) { wasRainShut = false; setWindow(SERVO_WINDOW_OPEN); }

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
  bool ttest = false, forgetTok = false, forgetChat = false;
  String token = "", chat = "";

  jsonGetNum(body, "gasWarn", warn);
  jsonGetNum(body, "gasDanger", danger);
  jsonGetNum(body, "gasHyst", hyst);
  jsonGetNum(body, "rainWetPct", rw);
  jsonGetNum(body, "rainFloodPct", rf);
  jsonGetBool(body, "rainInvert", invert);
  jsonGetBool(body, "autoControl", autc);
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

  String clientId = String(DEVICE_ID) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  String willTopic = baseTopic() + "/online";
  bool ok = (strlen(MQTT_USER) > 0)
    ? mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS,
                         willTopic.c_str(), 0, true, "offline")
    : mqttClient.connect(clientId.c_str(), nullptr, nullptr,
                         willTopic.c_str(), 0, true, "offline");
  if (ok) {
    mqttOnline = true;
    mqttClient.publish(willTopic.c_str(), "online", true);
    String base = baseTopic();
    mqttClient.subscribe((base + "/cmd").c_str(), 0);
    mqttClient.subscribe((base + "/settings").c_str(), 0);
    mqttClient.subscribe((base + "/histreq").c_str(), 0);
    Serial.print(F("[mqtt] baglandi: ")); Serial.print(MQTT_HOST);
    Serial.print(F("  konu: ")); Serial.println(base);
    publishStatus();
  } else {
    mqttOnline = false;
    Serial.print(F("[mqtt] baglanti basarisiz, durum=")); Serial.println(mqttClient.state());
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
  Serial.begin(115200);
  delay(200);
  bootMs = millis();
  Serial.println();
  Serial.println(F("=== Deneyap Ev Koruma v" FW_VERSION " (MQTT) ==="));

  if (PIN_LED >= 0) { pinMode(PIN_LED, OUTPUT); digitalWrite(PIN_LED, LOW); }

  analogReadResolution(10);

  loadSettings();

  pinMode(PIN_RELAY_FAN, OUTPUT);  digitalWrite(PIN_RELAY_FAN, LOW);
  pinMode(PIN_RELAY_PUMP, OUTPUT); digitalWrite(PIN_RELAY_PUMP, LOW);
  pinMode(PIN_BUZZER, OUTPUT);     digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_MQ2, INPUT);
  pinMode(PIN_RAIN, INPUT);
  outputsSafe("acilis");

  /* Servo başlangıç konumları, sonra motorları serbest bırak */
  setWindow(SERVO_WINDOW_OPEN);
  setBlind(SERVO_BLIND_SHUT);
  servoWindow.detach();
  servoBlind.detach();
  pinMode(PIN_SERVO_WINDOW, INPUT);
  pinMode(PIN_SERVO_BLIND, INPUT);
  servoReleaseAt = 0;

  /* Gaz tabanı ölçümü + ısınma penceresi */
  calibrateGasBaseline();
  warmUpUntilMs = millis() + GAS_WARMUP_MS;

  connectWiFi();

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
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

  /* MQTT bağlantısı */
  if (wifiStaOk && WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) {
      mqttOnline = false;
      if (timeReached(now, mqttRetryAt, 3000)) { mqttRetryAt = now; mqttConnect(); }
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
    }
    if (!floodBefore && floodActive) {
      tgSend(String("SU BASKINI! Islaklik %") + rainPct + ". Pencere kapatildi.", false);
    }
  }

  /* Su motoru taşma koruması */
  if (pumpOn && timeReached(now, pumpStartedMs, PUMP_MAX_RUN_MS)) {
    Serial.println(F("[guvenlik] su motoru azami sureyi asti, kapatildi"));
    setPump(false);
  }

  /* Servo hareketi bitince motorları serbest bırak */
  if (servoReleaseAt != 0 && (int32_t)(now - servoReleaseAt) >= 0) {
    servoWindow.detach();
    servoBlind.detach();
    pinMode(PIN_SERVO_WINDOW, INPUT);
    pinMode(PIN_SERVO_BLIND, INPUT);
    servoReleaseAt = 0;
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
    Serial.print(F("  durum: ")); Serial.print(gasStateName(gasState));
    Serial.print(F("  fan: ")); Serial.print(fanOn ? "ACIK" : "KAPALI");
    Serial.print(F("  pompa: ")); Serial.print(pumpOn ? "ACIK" : "KAPALI");
    Serial.print(F("  mqtt: ")); Serial.print(mqttOnline ? "BAGLI" : "YOK");
    Serial.print(F("  heap: ")); Serial.print(ESP.getFreeHeap());
    Serial.println(F(" B"));
  }
}
