package com.mabiltekin.deneyapevkoruma;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Ana ekran durum widget'ı.
 *
 * <p>Veriyi kendisi çekmez (pil ve güvenlik için); uygulama açıkken JS
 * köprüsü son durumu SharedPreferences'a yazar, widget da buradan okur.
 * Böylece widget her zaman "son bilinen" durumu gösterir.</p>
 */
public class StatusWidgetProvider extends AppWidgetProvider {

    private static final String KEY_STATUS = "widget_status";
    private static final String KEY_DETAIL = "widget_detail";
    private static final String KEY_UPDATED = "widget_updated";
    private static final String KEY_OK = "widget_ok";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            manager.updateAppWidget(id, buildViews(context));
        }
    }

    /** JS köprüsünden çağrılır: tüm widget'ları yeniden çizer. */
    public static void refreshAll(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            ComponentName name = new ComponentName(context, StatusWidgetProvider.class);
            int[] ids = manager.getAppWidgetIds(name);
            if (ids == null || ids.length == 0) return;
            for (int id : ids) {
                manager.updateAppWidget(id, buildViews(context));
            }
        } catch (Throwable ignored) {
            // Widget yoksa veya izin yoksa yoksay.
        }
    }

    /** JS köprüsü: durum metinlerini kaydeder ve widget'ı tazeler. */
    public static void saveStatus(Context context, String status, String detail, boolean ok) {
        AppNotifications.prefs(context).edit()
                .putString(KEY_STATUS, status == null ? "" : status)
                .putString(KEY_DETAIL, detail == null ? "" : detail)
                .putBoolean(KEY_OK, ok)
                .putLong(KEY_UPDATED, System.currentTimeMillis())
                .apply();
        refreshAll(context);
    }

    private static RemoteViews buildViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_status);

        String status = AppNotifications.prefs(context).getString(KEY_STATUS, "");
        String detail = AppNotifications.prefs(context).getString(KEY_DETAIL, "");
        boolean ok = AppNotifications.prefs(context).getBoolean(KEY_OK, false);
        long updated = AppNotifications.prefs(context).getLong(KEY_UPDATED, 0L);

        if (status == null || status.trim().isEmpty()) {
            status = "Panel bekleniyor";
            detail = "Ayrıntı için dokunun";
        } else if (updated > 0) {
            String saat = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(updated));
            detail = detail + " · " + saat;
        }

        views.setTextViewText(R.id.widget_status, status);
        views.setTextViewText(R.id.widget_detail, detail);
        views.setTextColor(R.id.widget_status, ok ? 0xFF34D399 : 0xFFFBBF24);

        String base = context.getString(R.string.start_url);

        Intent open = new Intent(context, WebViewActivity.class);
        open.putExtra(WebViewActivity.EXTRA_URL, base);
        open.putExtra(WebViewActivity.EXTRA_FROM_NOTIFICATION, true);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(R.id.widget_root, pending(context, open, 11));

        Intent guard = new Intent(context, WebViewActivity.class);
        guard.putExtra(WebViewActivity.EXTRA_URL, withFragment(base, "command-center"));
        guard.putExtra(WebViewActivity.EXTRA_FROM_NOTIFICATION, true);
        guard.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(R.id.widget_guard, pending(context, guard, 12));

        return views;
    }

    private static PendingIntent pending(Context context, Intent intent, int code) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, code, intent, flags);
    }

    private static String withFragment(String base, String fragment) {
        int hash = base.indexOf('#');
        if (hash >= 0) base = base.substring(0, hash);
        return base + "#" + fragment;
    }
}
