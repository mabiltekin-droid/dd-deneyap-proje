/*
 * config.local.example.h — yerel gizli ayarlar örneği
 * ----------------------------------------------------------------------------
 * Bu dosyayı `config.local.h` olarak kopyalayın ve gerçek değerleri girin.
 * `config.local.h` .gitignore içindedir; depoya gönderilmez.
 *
 * config.h, bu dosyayı en sonda include eder. Varsayılanları ezmek için
 * aşağıdaki gibi önce #undef kullanın.
 */

/* ---- Wi-Fi ----
#undef WIFI_SSID
#define WIFI_SSID "EV_WIFI_ADI"
#undef WIFI_PASS
#define WIFI_PASS "EV_WIFI_SIFRESI"
*/

/* ---- Uzak bildirim (Vercel /api/push) ----
 * PUSH_URL varsayılanı zaten production adresidir. Yalnızca farklı bir
 * sunucu kullanıyorsanız PUSH_URL'i de değiştirin.
#undef PUSH_URL
#define PUSH_URL "https://ddproje.vercel.app/api/push"

#undef PUSH_SECRET
#define PUSH_SECRET "VERCEL_PUSH_TRIGGER_SECRET"
*/

/* ---- OTA ----
#undef OTA_PASSWORD
#define OTA_PASSWORD "en-az-8-karakter"
*/

/* ---- Cihaz kimliği (isteğe bağlı) ----
#undef DEVICE_ID
#define DEVICE_ID "kart1"
*/
