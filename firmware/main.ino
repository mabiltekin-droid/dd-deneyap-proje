/*
 * ============================================================================
 *  Deneyap Ev Koruma Sistemi — firmware  v2.2.0
 * ----------------------------------------------------------------------------
 *  • Access Point modunda çalışır (AP_SSID) -> cihazın adresi 192.168.4.1
 *  • LittleFS'ten PWA'yı kendisi sunar  (/, /settings.html, /css, /js, ...)
 *  • LittleFS yoksa "API-only" moduna düşer ve ne yapılacağını anlatan bir
 *    sayfa gösterir (graceful fallback)
 *  • Cihaz durumunu JSON olarak açar:  GET /api/status
 *  • Cihazları kontrol eder:             POST /api/control  {"device","action"}
 *
 *  Donanım / eşik ayarları -> config.h
 *  Web arayüzü            -> ../pwa  (cihazın LittleFS'ine yüklenir)
 * ============================================================================
 */

#include <WiFi.h>
#include <WebServer.h>
#include <Servo.h>
#include <LittleFS.h>

#include "config.h"

/* ------------------------------------------------------------------ durum */

enum GasState : uint8_t { GAS_NORMAL = 0, GAS_WARN = 1, GAS_DANGER = 2 };

WebServer  server(80);
Servo      servoWindow;
Servo      servoBlind;

bool         fsReady        = false;
size_t       fsTotal        = 0;
size_t       fsUsed         = 0;

int          gasRaw         = 0;      // 0..1023
int          gasPpm         = 0;
int          gasBaseRaw     = 0;      // açılışta ölçülen temiz hava değeri
int          rainRaw        = 0;
GasState     gasState       = GAS_NORMAL;

bool         fanOn          = false;
bool         pumpOn         = false;
bool         buzzerOn       = false;
bool         autoControl    = true;
bool         fanByAutomation= false;
bool         wasDanger      = false;
int          windowPos      = SERVO_WINDOW_OPEN;   // 0=kapalı 180=açık
int          blindPos       = SERVO_BLIND_SHUT;    // 0=kapalı 180=açık

uint32_t     bootMs         = 0;
uint32_t     lastSensorMs   = 0;
uint32_t     lastReportMs   = 0;
uint32_t     fanLatchedMs   = 0;
uint32_t     pumpStartedMs  = 0;
uint32_t     servoMovingMs  = 0;

bool         rainWet        = false;
uint8_t      lastClients    = 0xFF;

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

/* Çıktıları güvenli duruma al — açılışta ve bağlantı kopmasında çağrılır.
   Röle OFF = su pompası durur, fan durur. */
static void allOutputsSafe(const char *reason) {
  digitalWrite(PIN_RELAY_FAN, LOW);
  digitalWrite(PIN_RELAY_PUMP, LOW);
  digitalWrite(PIN_BUZZER, LOW);
  fanOn = pumpOn = buzzerOn = false;
  fanByAutomation = false;
  if (reason) {
    Serial.print(F("[guvenlik] tum cikislar kapatildi: "));
    Serial.println(reason);
  }
}

/* ------------------------------------------------------- JSON yardımcıları */
/* Tam JSON kütüphanesi yerine iki alanlık gövde ayrıştırıcı — kontrol
   uçlarında sadece "device" ve "action" okumamız gerekiyor. */

static int jsonKeyPos(const String &body, const char *key) {
  String pat = String("\"") + key + "\"";
  return body.indexOf(pat);
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
    pumpOn = false;
    digitalWrite(PIN_RELAY_PUMP, LOW);
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

/* Servo "stop": aktüatörü sürüklemeden bırakmak için servoyu ayırır.
   Sürekli dönen motorlarda servo.detach() yapılmazsa motor ısınır. */
static void servoRelease(Servo &s, int pin) {
  s.detach();
  pinMode(pin, INPUT);
  servoMovingMs = millis() + SERVO_MOVE_MS;
}

static void setWindow(int angle) {
  if (angle < 0)   angle = 0;
  if (angle > 180) angle = 180;
  servoWindow.attach(PIN_SERVO_WINDOW);
  pinMode(PIN_SERVO_WINDOW, OUTPUT);
  servoWindow.write(angle);
  windowPos = angle;
  servoMovingMs = millis() + SERVO_MOVE_MS;
  Serial.print(F("[servo] pencere -> "));
  Serial.println(angle);
}

static void setBlind(int angle) {
  if (angle < 0)   angle = 0;
  if (angle > 180) angle = 180;
  servoBlind.attach(PIN_SERVO_BLIND);
  pinMode(PIN_SERVO_BLIND, OUTPUT);
  servoBlind.write(angle);
  blindPos = angle;
  servoMovingMs = millis() + SERVO_MOVE_MS;
  Serial.print(F("[servo] panjur -> "));
  Serial.println(angle);
}

/* ------------------------------------------------------ sensör + otomasyon */

static void calibrateGasBaseline() {
  Serial.println(F("[mq2] temiz hava tabanı ölçülüyor..."));
  long sum = 0;
  int  n   = 0;
  for (int i = 0; i < GAS_CLEAN_SAMPLES; i++) {
    int v = analogRead(PIN_MQ2);
    if (v > GAS_BASE_MIN) { sum += v; n++; }      // geçersiz ölçümleri at
    delay(100);
  }
  gasBaseRaw = (n > 0) ? (int)(sum / n) : 200;
  Serial.print(F("[mq2] taban="));
  Serial.print(gasBaseRaw);
  Serial.print(F(" (geçerli ölçüm "));
  Serial.print(n);
  Serial.println(F("/20)"));
}

static void readSensors() {
  gasRaw  = analogRead(PIN_MQ2);
  rainRaw = analogRead(PIN_RAIN);

  /* Ham ADC -> PPM (doğrusal model, config.h'de belgeli) */
  if (gasBaseRaw < GAS_BASE_MIN) gasBaseRaw = 200;
  float span = ADC_FULL_SCALE - (float)gasBaseRaw;
  float ppm  = ((float)gasRaw - (float)gasBaseRaw) * (GAS_PPM_FULL_SCALE / span);
  gasPpm = (ppm < 0) ? 0 : (int)(ppm + 0.5f);
  if (gasPpm > (int)GAS_PPM_FULL_SCALE) gasPpm = (int)GAS_PPM_FULL_SCALE;

  rainWet = (rainRaw >= RAIN_WET_ABOVE_RAW);

  /* Histerezisli durum makinesi — eşikte salınmayı önler */
  GasState prev = gasState;
  switch (gasState) {
    case GAS_NORMAL:
      if (gasPpm >= GAS_DANGER_PPM)     gasState = GAS_DANGER;
      else if (gasPpm >= GAS_WARN_PPM)   gasState = GAS_WARN;
      break;
    case GAS_WARN:
      if (gasPpm >= GAS_DANGER_PPM)                    gasState = GAS_DANGER;
      else if (gasPpm < (GAS_WARN_PPM - GAS_HYSTERESIS)) gasState = GAS_NORMAL;
      break;
    case GAS_DANGER:
      if (gasPpm < (GAS_DANGER_PPM - GAS_HYSTERESIS)) gasState = GAS_WARN;
      break;
  }
  if (gasState != prev) {
    Serial.print(F("[durum] gaz -> "));
    Serial.print(gasStateName(gasState));
    Serial.print(F("  ppm="));
    Serial.println(gasPpm);
  }
}

static void runAutomation() {
  uint32_t now = millis();

  if (gasState == GAS_DANGER) {
    setBuzzer(true);
    setFan(true, true);          // gaz çekilmesi için fan
    setPump(false);              // gaz varken su pompası kesinlikle kapalı
    if (autoControl && !wasDanger) setWindow(SERVO_WINDOW_SHUT);
    wasDanger = true;
    return;
  }

  setBuzzer(false);

  /* Fan sadece otomasyon açtıysa ve süre dolduysa kendiliğinden kapansın.
     (Kullanıcı elle açtıysa dokunulmaz.) */
  if (fanByAutomation && timeReached(now, fanLatchedMs, FAN_AUTO_OFF_MS)) {
    setFan(false, false);
  }

  /* Tehlike bittiğinde pencere geri açılır */
  if (wasDanger && gasState == GAS_WARN) {
    wasDanger = false;
    if (autoControl) setWindow(SERVO_WINDOW_OPEN);
  }
}

/* ------------------------------------------------------------ JSON cevap */

static void sendJson(const char *json) {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json; charset=utf-8", json);
}

static void sendError(int code, const char *msg) {
  char buf[160];
  snprintf(buf, sizeof(buf), "{\"ok\":false,\"error\":\"%s\"}", msg);
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-store");
  server.send(code, "application/json; charset=utf-8", buf);
}

/* GET /api/status — PWA'nın periyodik olarak çektiği ana uç */
static void handleStatus() {
  char   buf[STATUS_JSON_MAX];
  uint32_t now = millis();
  bool moving = (int32_t)(servoMovingMs - now) > 0;

  snprintf(buf, sizeof(buf),
    "{\"ok\":true,\"fw\":\"%s\",\"t\":%lu,\"rssi\":%d,\"ip\":\"%s\",\"clients\":%d,"
    "\"heap\":%lu,\"uptime\":%lu,"
    "\"gasRaw\":%d,\"gasPpm\":%d,\"gasBase\":%d,\"rainRaw\":%d,\"rain\":%s,\"state\":\"%s\","
    "\"fan\":%s,\"pump\":%s,\"buzzer\":%s,\"auto\":%s,\"window\":%d,\"blind\":%d,\"moving\":%s,"
    "\"fs\":%s,\"fsUsed\":%lu,\"fsTotal\":%lu}",
    FW_VERSION,
    (unsigned long)now,
    WiFi.RSSI(),
    WiFi.softAPIP().toString().c_str(),
    WiFi.softAPClientCount(),
    (unsigned long)ESP.getFreeHeap(),
    (unsigned long)(now - bootMs),
    gasRaw, gasPpm, gasBaseRaw,
    rainRaw,
    rainWet ? "true" : "false",
    gasStateName(gasState),
    fanOn ? "true" : "false",
    pumpOn ? "true" : "false",
    buzzerOn ? "true" : "false",
    autoControl ? "true" : "false",
    windowPos, blindPos,
    moving ? "true" : "false",
    fsReady ? "true" : "false",
    (unsigned long)fsUsed,
    (unsigned long)fsTotal);

  sendJson(buf);
}

/* --------------------------------------------------- kontrol uçları (JSON) */

static bool authorize() {
  if (strlen(API_TOKEN) == 0) return true;              // koruma kapalı
  if (server.header("X-Auth-Token") == API_TOKEN) return true;
  if (server.arg("token") == API_TOKEN) return true;     // link ile tetikleme
  sendError(401, "unauthorized");
  return false;
}

static void applyCommand(const String &device, const String &action, long value) {
  if (device == "fan") {
    if (action == "on")       setFan(true, false);
    else if (action == "off") setFan(false, false);
    else if (action == "toggle") setFan(!fanOn, false);

  } else if (device == "pump") {
    if (gasState == GAS_DANGER && action != "off") {
      sendError(409, "gaz alarmi aktif, su motoru kilitli");
      return;
    }
    if (action == "on")            setPump(true);
    else if (action == "off")      setPump(false);
    else if (action == "toggle")   setPump(!pumpOn);

  } else if (device == "buzzer") {
    if (action == "on")      setBuzzer(true);
    else if (action == "off") setBuzzer(false);
    else if (action == "toggle") setBuzzer(!buzzerOn);

  } else if (device == "window") {
    if (action == "open")  setWindow(SERVO_WINDOW_OPEN);
    else if (action == "shut") setWindow(SERVO_WINDOW_SHUT);
    else if (action == "ajar") setWindow(SERVO_WINDOW_AJAR);
    else if (action == "stop") servoRelease(servoWindow, PIN_SERVO_WINDOW);

  } else if (device == "blind") {
    if (action == "open")  setBlind(SERVO_BLIND_OPEN);
    else if (action == "shut") setBlind(SERVO_BLIND_SHUT);
    else if (action == "stop") servoRelease(servoBlind, PIN_SERVO_BLIND);

  } else if (device == "auto") {
    if (action == "on")        autoControl = true;
    else if (action == "off") autoControl = false;
    else if (action == "toggle") autoControl = !autoControl;
    if (!autoControl && gasState != GAS_DANGER) setWindow(SERVO_WINDOW_OPEN);

  } else if (device == "reboot") {
    sendJson("{\"ok\":true,\"msg\":\"yeniden baslatiliyor\"}");
    delay(150);
    ESP.restart();
    return;

  } else {
    sendError(400, "bilinmeyen cihaz");
    return;
  }

  (void)value;
  Serial.print(F("[komut] "));
  Serial.print(device);
  Serial.print(F(" -> "));
  Serial.println(action);
  handleStatus();               // işlem sonrası anlık durum dön
}

static void handleControlPost() {
  if (!authorize()) return;
  String body = server.arg("plain");
  String device, action;
  long   value = 0;
  if (!jsonGetStr(body, "device", device) || !jsonGetStr(body, "action", action)) {
    sendError(400, "gecersiz govde (device/action bekleniyor)");
    return;
  }
  jsonGetNum(body, "value", value);
  applyCommand(device, action, value);
}

/* GET /api/control?device=fan&action=on — JS'siz (tarayıcı düğmesi) kullanım */
static void handleControlGet() {
  if (!authorize()) return;
  String device = server.arg("device");
  String action = server.arg("action");
  if (device.length() == 0 || action.length() == 0) {
    sendError(400, "device & action gerekli");
    return;
  }
  applyCommand(device, action, 0);
}

static void handleOptions() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, X-Auth-Token");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.send(204, "text/plain", "");
}

/* ------------------------------------------------------ statik dosya sunucu */

static String mimeFor(const String &path) {
  if (path.endsWith(".html") || path.endsWith("/")) return "text/html; charset=utf-8";
  if (path.endsWith(".css"))  return "text/css; charset=utf-8";
  if (path.endsWith(".js"))   return "application/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
  if (path.endsWith(".png"))  return "image/png";
  if (path.endsWith(".svg"))  return "image/svg+xml";
  if (path.endsWith(".ico"))  return "image/x-icon";
  return "application/octet-stream";
}

/* Dosya sistemi yoksa kullanıcıya ne yapması gerektiğini anlatan sayfa.
   PROGMEM: string literalleri RAM'e kopyalanmasın. */
static const char PAGE_NO_FS[] PROGMEM = R"HTMLPAGE(
<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#121212"><title>Deneyap Ev Koruma — Dosya sistemi boş</title>
<style>
 body{background:#121212;color:#f1f1f1;font:16px/1.6 system-ui,sans-serif;margin:0;padding:2rem 1.25rem;display:flex;justify-content:center}
 main{max-width:640px} h1{font-size:1.6rem;margin:0 0 .5rem}
 .box{border:1px solid #2c2c2c;border-radius:12px;padding:1.25rem;margin:1.25rem 0;background:#1e1e1e}
 code{background:#000;padding:.15rem .4rem;border-radius:4px;color:#ffb829}
 .ok{color:#2ecc71}.warn{color:#ffb829} a{color:#3794ff}
 table{width:100%;border-collapse:collapse}td{padding:.35rem 0}
</style></head><body><main>
<h1>API-only modu</h1>
<p>Cihaz çalışıyor ve JSON API yayında, ancak <b>web arayüzü (PWA) yüklenmemiş.</b></p>
<div class="box">
<b>Çözüm — web arayüzünü yükle:</b>
<ol>
<li><code>pwa/</code> klasöründeki tüm dosyaları cihazın <code>LittleFS</code> bölümüne kopyala.</li>
<li>Arduino IDE: <i>Araçlar &gt; LittleFS Data Upload</i> ile yükle.</li>
<li>Ya da PlatformIO ile: <code>pio run -t uploadfs</code></li>
<li>Kartı yeniden başlat.</li>
</ol>
</div>
<div class="box">
<b>Bu arada API çalışıyor:</b>
<table>
<tr><td><a href="/api/status">/api/status</a></td><td class="ok">anlık sensör durumu (JSON)</td></tr>
<tr><td><a href="/api/control?device=fan&amp;action=on">/api/control?device=fan&amp;action=on</a></td><td>fan aç</td></tr>
<tr><td><a href="/api/control?device=fan&amp;action=off">/api/control?device=fan&amp;action=off</a></td><td>fan kapat</td></tr>
<tr><td><a href="/api/control?device=window&amp;action=open">/api/control?device=window&amp;action=open</a></td><td>pencere aç</td></tr>
<tr><td><a href="/api/control?device=blind&amp;action=shut">/api/control?device=blind&amp;action=shut</a></td><td>panjur kapat</td></tr>
</table>
</div>
<p class="warn">Su motoru varsayılan olarak <b>kapalı</b> güvenli durumda başlar.</p>
</main></body></html>
)HTMLPAGE";

static const char PAGE_404[] PROGMEM = R"HTMLPAGE(
<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>404</title>
<style>body{background:#121212;color:#f1f1f1;font:16px system-ui,sans-serif;display:flex;
align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}
a{color:#3794ff}</style></head><body><div><h1>404</h1>
<p>Bu adres cihazda yok.</p><p><a href="/">Ana ekrana dön</a></p></div></body></html>
)HTMLPAGE";

static void sendProgmemPage(const char *page) {
  server.sendHeader("Cache-Control", "no-store");
  server.send_P(200, "text/html; charset=utf-8", page);
}

static void serveStatic() {
  if (!fsReady) { sendProgmemPage(PAGE_NO_FS); return; }

  String path = server.uri();                 // sorgu dizesi dahil değil
  if (path.length() == 0 || path == "/") path = "/index.html";
  if (!path.startsWith("/")) path = "/" + path;

  /* Path traversal koruması: "..", "//", ":" ve ters eğik çizgi reddedilir */
  if (path.indexOf("..") >= 0 || path.indexOf("//") >= 0 ||
      path.indexOf(':') >= 0  || path.indexOf('\\') >= 0) {
    server.send(400, "text/plain; charset=utf-8", "Gecersiz yol");
    return;
  }

  if (!LittleFS.exists(path)) {
    /* Uzantısız isteklerde .html dene:  /ayarlar -> /ayarlar.html */
    if (path.indexOf('.') < 0 && LittleFS.exists(path + ".html")) {
      path = path + ".html";
    } else {
      server.sendHeader("Cache-Control", "no-store");
      server.send_P(404, "text/html; charset=utf-8", PAGE_404);
      return;
    }
  }

  File file = LittleFS.open(path, "r");
  if (file && file.isDirectory()) {
    file.close();
    path = path.endsWith("/") ? path + "index.html" : path + "/index.html";
    file = LittleFS.open(path, "r");
  }
  if (!file || file.isDirectory()) {
    if (file) file.close();
    server.sendHeader("Cache-Control", "no-store");
    server.send_P(404, "text/html; charset=utf-8", PAGE_404);
    return;
  }

  const String mime = mimeFor(path);
  const size_t  len  = file.size();
  file.close();

  /* HTML/JS/CSS/SW asla uzun süre önbelleklenmesin: tarayıcı her açılışta
     cihaza sorup doğrulasın. Aksi halde eski sürüm ekranda kalır. */
  server.sendHeader("Cache-Control", "no-cache");
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, mime.c_str(), "");

  uint8_t buf[1024];
  File     stream = LittleFS.open(path, "r");
  if (!stream) return;
  size_t sent = 0;
  while (sent < len && stream.available()) {
    size_t chunk = stream.readBytes(buf, sizeof(buf));
    if (chunk == 0) break;
    server.sendContent((const char *)buf, chunk);
    sent += chunk;
    delay(0);                       // watchdog'u besle, tıka basa yığılmasın
  }
  stream.close();
  server.sendContent("");            // bağlantıyı düzgün kapat
}

/* ------------------------------------------------------------------ kurulum */

void setup() {
  Serial.begin(115200);
  delay(200);
  bootMs = millis();
  Serial.println();
  Serial.println(F("=== Deneyap Ev Koruma v2.2.0 ==="));

  /* 1) Çıkışları güvenli duruma al — pinMode(OUTPUT) LOW verir ama açıkça yaz */
  pinMode(PIN_RELAY_FAN, OUTPUT);  digitalWrite(PIN_RELAY_FAN, LOW);
  pinMode(PIN_RELAY_PUMP, OUTPUT); digitalWrite(PIN_RELAY_PUMP, LOW);
  pinMode(PIN_BUZZER, OUTPUT);     digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_MQ2, INPUT);
  pinMode(PIN_RAIN, INPUT);
  allOutputsSafe("acilis");

  /* 2) Web arayüzünü depodan yükle (yoksa API-only modu) */
  if (LittleFS.begin(true)) {
    fsReady = true;
    fsTotal = LittleFS.totalBytes();
    fsUsed  = LittleFS.usedBytes();
    Serial.print(F("[fs] LittleFS baglandi, "));
    Serial.print(fsUsed); Serial.print(F(" / ")); Serial.print(fsTotal);
    Serial.println(F(" bayt kullaniliyor"));
    if (!LittleFS.exists(String(WEB_ROOT) + "index.html")) {
      Serial.println(F("[fs] UYARI: index.html yok - API-only modunda calisiliyor"));
    }
  } else {
    fsReady = false;
    Serial.println(F("[fs] LittleFS acilamadi - API-only modu"));
  }

  /* 3) Gaz sensörü temiz hava tabanı */
  calibrateGasBaseline();

  /* 4) Servoları başlangıç konumuna getir */
  setWindow(SERVO_WINDOW_OPEN);
  setBlind(SERVO_BLIND_SHUT);
  servoWindow.detach();
  servoBlind.detach();
  pinMode(PIN_SERVO_WINDOW, INPUT);
  pinMode(PIN_SERVO_BLIND, INPUT);
  Serial.println(F("[servo] baslangic konumlari ayarlandi, motorlar serbest"));

  /* 5) Access Point (kullanıcı kararı: sadece AP modu) */
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1),
                    IPAddress(192, 168, 4, 1));
  bool ap = WiFi.softAP(AP_SSID, AP_PASSWORD, AP_CHANNEL, AP_HIDDEN, AP_MAX_CLIENTS);
  if (!ap) {
    // Parola çok kısa gibi duruyorsa — parolasız dene, en azından cihaz açılsın
    ap = WiFi.softAP(AP_SSID);
    Serial.println(F("[wifi] parolali AP basarisiz, parolasiz deneniyor"));
  }

  Serial.print(F("[wifi] SSID: "));
  Serial.println(AP_SSID);
  Serial.print(F("[wifi] cihaz adresi: http://"));
  Serial.println(WiFi.softAPIP());
  Serial.print(F("[http] kontrol koruma: "));
  Serial.println(strlen(API_TOKEN) ? "acik (token zorunlu)" : "kapali (API_TOKEN bos)");

  /* 6) Rotalar */
  server.on("/api/status",   HTTP_GET,  handleStatus);
  server.on("/api/control",  HTTP_POST, handleControlPost);
  server.on("/api/control",  HTTP_GET,  handleControlGet);
  server.on("/api/control",  HTTP_OPTIONS, handleOptions);
  server.on("/api/status",   HTTP_OPTIONS, handleOptions);
  server.onNotFound(serveStatic);          // /, /css/*, /js/*, /sw.js, /icons/*
  server.setTimeout(HTTP_TIMEOUT_MS);

  server.begin();
  Serial.println(F("[http] sunucu hazir"));
  if (!fsReady) Serial.println(F("[http] PWA yuklu degil - /adresinde yonlendirme sayfasi acilacak"));
}

void loop() {
  server.handleClient();

  const uint32_t now = millis();

  if (timeReached(now, lastSensorMs, SENSOR_INTERVAL_MS)) {
    lastSensorMs = now;
    readSensors();
    runAutomation();
  }

  /* Su motoru taşma koruması — kontrol cihazdan gelmese bile kendi kendine durur */
  if (pumpOn && timeReached(now, pumpStartedMs, PUMP_MAX_RUN_MS)) {
    Serial.println(F("[guvenlik] su motoru azami calisma suresini asti, kapatildi"));
    setPump(false);
  }

  /* Ağa bağlı istemci kalmayınca röleleri güvenli duruma al.
     (WiFi event enum'ları ESP32 çekirdek sürümleri arasında değiştiği için
      sayaç üzerinden takip etmek daha taşınabilir bir yöntem.) */
  uint8_t clients = WiFi.softAPClientCount();
  if (clients != lastClients) {
    if (clients == 0) allOutputsSafe("bagli istemci yok");
    lastClients = clients;
  }

  /* Seri monitör raporu */
  if (timeReached(now, lastReportMs, SERIAL_REPORT_MS)) {
    lastReportMs = now;
    Serial.print(F("gaz: "));   Serial.print(gasPpm);
    Serial.print(F(" ppm (ham ")); Serial.print(gasRaw);
    Serial.print(F(")  yağmur: ")); Serial.print(rainWet ? "ISLAK" : "KURU");
    Serial.print(F(" (ham ")); Serial.print(rainRaw);
    Serial.print(F(")  durum: ")); Serial.print(gasStateName(gasState));
    Serial.print(F("  fan: ")); Serial.print(fanOn ? "ACIK" : "KAPALI");
    Serial.print(F("  pompa: ")); Serial.print(pumpOn ? "ACIK" : "KAPALI");
    Serial.print(F("  RSSI: ")); Serial.print(WiFi.RSSI());
    Serial.print(F(" dBm  heap: ")); Serial.print(ESP.getFreeHeap());
    Serial.println(F(" B"));
  }
}