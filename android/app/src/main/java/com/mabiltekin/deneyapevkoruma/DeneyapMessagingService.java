package com.mabiltekin.deneyapevkoruma;

import android.content.Context;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * FCM alıcısı.
 *
 * <p>Sunucu <b>data-only</b> mesaj gönderir; böylece uygulama kapalıyken de
 * bu sınıf çalışır ve bildirimi biz oluştururuz. Veri anahtarları:</p>
 * <pre>
 *   kind  : flame | gas | flood | vib | offline | status | test
 *   title : bildirim başlığı (opsiyonel)
 *   body  : açıklama (opsiyonel)
 *   url   : dokununca açılacak adres (opsiyonel)
 * </pre>
 */
public class DeneyapMessagingService extends FirebaseMessagingService {

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        AppNotifications.prefs(this).edit()
                .putString(AppNotifications.KEY_FCM_TOKEN, token)
                .apply();
        WebViewActivity.notifyFcmToken(token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        super.onMessageReceived(message);

        Map<String, String> data = message.getData();
        String kind = value(data, "kind", "test");

        /* Canlı durum satırını sunucudan güncelle (opsiyonel). */
        if ("status".equals(kind)) {
            AppNotifications.showStatus(this,
                    value(data, "title", "Sistem durumu"),
                    value(data, "body", "Son durum"),
                    value(data, "big", ""),
                    value(data, "url", null));
            return;
        }

        String title = value(data, "title", null);
        String body = value(data, "body", null);

        /* Sunucu bildirim (notification) yükü de gönderdiyse onu kullan. */
        RemoteMessage.Notification n = message.getNotification();
        if (title == null && n != null) title = n.getTitle();
        if (body == null && n != null) body = n.getBody();

        if (title == null) title = "Güvenlik alarmı";
        if (body == null) body = "Evdeki durumu kontrol edin.";

        AppNotifications.showAlarm(this, title, body, kind, value(data, "url", null));
    }

    private static String value(Map<String, String> data, String key, String fallback) {
        if (data == null) return fallback;
        String v = data.get(key);
        return (v == null || v.trim().isEmpty()) ? fallback : v;
    }

    /** Token'ı Firebase'e kaydeder; JS tarafı da aynı değeri okuyabilir. */
    public static String currentToken(Context c) {
        return AppNotifications.prefs(c).getString(AppNotifications.KEY_FCM_TOKEN, "");
    }
}
