package com.mabiltekin.deneyapevkoruma;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Uygulamanın yerel bildirimleri.
 *
 * <p>İki kanal vardır:</p>
 * <ul>
 *   <li><b>dd_alarm_v1</b> — gaz/alev/su/sarsıntı alarmları. Yüksek önem,
 *       ses ve titreşim. FCM ile uygulama kapalıyken de gösterilir.</li>
 *   <li><b>dd_status_v1</b> — bildirim panelinde sürekli duran, sessiz
 *       "son durum" satırı. Yalnızca kullanıcı isterse açılır.</li>
 * </ul>
 */
public final class AppNotifications {

    public static final String CH_ALARM = "dd_alarm_v1";
    public static final String CH_STATUS = "dd_status_v1";

    public static final int STATUS_ID = 4101;
    public static final int ALARM_ID = 4200;

    public static final String PREFS = "deneyap_native";
    public static final String KEY_STATUS_ENABLED = "status_notification_enabled";
    public static final String KEY_FCM_TOKEN = "fcm_token";
    public static final String KEY_LAST_URL = "last_url";
    public static final String KEY_NOTIF_ASKED = "notification_permission_asked";

    private AppNotifications() {
    }

    public static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Kanalları oluşturur; her açılışta çağrılabilir (idempotent). */
    public static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        NotificationChannel status = new NotificationChannel(
                CH_STATUS, "Canlı durum", NotificationManager.IMPORTANCE_LOW);
        status.setDescription("Bildirim panelinde kalan sessiz sistem durumu.");
        status.setShowBadge(false);
        status.enableVibration(false);
        status.setSound(null, null);
        status.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(status);

        NotificationChannel alarm = new NotificationChannel(
                CH_ALARM, "Güvenlik alarmları", NotificationManager.IMPORTANCE_HIGH);
        alarm.setDescription("Gaz, alev, su baskını ve sarsıntı uyarıları.");
        alarm.enableVibration(true);
        alarm.setVibrationPattern(new long[]{0, 450, 180, 450, 180, 700});
        alarm.enableLights(true);
        alarm.setLightColor(Color.RED);
        alarm.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        alarm.setShowBadge(true);
        try {
            AudioAttributes audio = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            alarm.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, audio);
        } catch (Throwable ignored) {
            // Ses ayarlanamazsa kanal varsayılan sesi kullanır.
        }
        nm.createNotificationChannel(alarm);
    }

    public static boolean hasPermission(Context c) {
        if (Build.VERSION.SDK_INT >= 33) {
            return c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED
                    && NotificationManagerCompat.from(c).areNotificationsEnabled();
        }
        return NotificationManagerCompat.from(c).areNotificationsEnabled();
    }

    /** Android 13+ için izin ister; zaten verilmişse true döner. */
    public static boolean requestPermission(Activity activity, int requestCode) {
        if (hasPermission(activity)) return true;
        prefs(activity).edit().putBoolean(KEY_NOTIF_ASKED, true).apply();
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                activity.requestPermissions(
                        new String[]{Manifest.permission.POST_NOTIFICATIONS}, requestCode);
            } catch (Throwable ignored) {
                return false;
            }
        }
        return false;
    }

    public static boolean statusEnabled(Context c) {
        return prefs(c).getBoolean(KEY_STATUS_ENABLED, false);
    }

    public static void setStatusEnabled(Context c, boolean enabled) {
        prefs(c).edit().putBoolean(KEY_STATUS_ENABLED, enabled).apply();
        if (!enabled) clearStatus(c);
    }

    /**
     * Sürekli (ongoing) durum bildirimini günceller.
     *
     * @param title kısa başlık, ör. "Sistem güvende"
     * @param body  tek satır, ör. "Gaz 120 ppm · Evde · 14:32"
     * @param big   genişletilmiş metin (opsiyonel)
     * @param url   dokununca açılacak adres (opsiyonel)
     */
    public static void showStatus(Context c, String title, String body, String big, String url) {
        ensureChannels(c);
        if (!statusEnabled(c) || !hasPermission(c)) return;

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_STATUS)
                .setSmallIcon(R.drawable.ic_stat_deneyap)
                .setColor(0xFF10B981)
                .setContentTitle(safe(title, "Sistem durumu"))
                .setContentText(safe(body, "Son durum"))
                .setContentIntent(openIntent(c, url, 1))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setSilent(true);

        if (big != null && !big.trim().isEmpty()) {
            b.setStyle(new NotificationCompat.BigTextStyle().bigText(big));
        }

        try {
            NotificationManagerCompat.from(c).notify(STATUS_ID, b.build());
        } catch (SecurityException ignored) {
            // İzin kaldırılmışsa sessizce dur.
        }
    }

    public static void clearStatus(Context c) {
        try {
            NotificationManagerCompat.from(c).cancel(STATUS_ID);
        } catch (Throwable ignored) {
            // yoksay
        }
    }

    /** Alarm bildirimi gösterir (FCM veya yerel test). */
    public static void showAlarm(Context c, String title, String body, String kind, String url) {
        ensureChannels(c);
        if (!hasPermission(c)) return;

        String tag = kind == null ? "alarm" : kind;
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_ALARM)
                .setSmallIcon(R.drawable.ic_stat_deneyap)
                .setColor(0xFFEF4444)
                .setContentTitle(safe(title, "Güvenlik alarmı"))
                .setContentText(safe(body, "Evdeki durumu kontrol edin."))
                .setStyle(new NotificationCompat.BigTextStyle().bigText(safe(body, "")))
                .setContentIntent(openIntent(c, url, 2))
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setDefaults(NotificationCompat.DEFAULT_ALL);

        try {
            NotificationManagerCompat.from(c).notify(tag.hashCode(), b.build());
        } catch (SecurityException ignored) {
            // yoksay
        }
    }

    public static PendingIntent openIntent(Context c, String url, int requestCode) {
        Intent intent = new Intent(c, WebViewActivity.class);
        intent.putExtra(WebViewActivity.EXTRA_URL, url);
        intent.putExtra(WebViewActivity.EXTRA_FROM_NOTIFICATION, true);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(c, requestCode, intent, flags);
    }

    private static String safe(String value, String fallback) {
        return (value == null || value.trim().isEmpty()) ? fallback : value;
    }

    /** Test / hata ayıklama için kanal ayarlarını açar. */
    public static void openChannelSettings(Context c) {
        try {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
        } catch (Throwable ignored) {
            // yoksay
        }
    }
}
