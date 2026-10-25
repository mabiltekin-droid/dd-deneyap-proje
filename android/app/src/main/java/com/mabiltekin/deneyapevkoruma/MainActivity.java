package com.mabiltekin.deneyapevkoruma;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;

/**
 * Uygulamanın tek giriş noktası.
 *
 * <p>Uygulama artık doğrudan yerel WebView kabuğunu açar; Chrome yalnızca
 * "Chrome'da aç" (Google girişi / web bildirimleri) istendiğinde kullanılır.
 * Böylece ilk açılışta adres çubuğu görünmez ve uygulama gibi çalışır.</p>
 */
public class MainActivity extends Activity {

    public static final String EXTRA_SHORTCUT = "shortcut";
    public static final String SHORTCUT_CHROME = "chrome";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String shortcut = getIntent().getStringExtra(EXTRA_SHORTCUT);

        if (SHORTCUT_CHROME.equals(shortcut)) {
            openInChrome(this, getString(R.string.start_url));
            finish();
            return;
        }

        Intent intent = new Intent(this, WebViewActivity.class);
        intent.putExtra(WebViewActivity.EXTRA_URL, buildUrl(shortcut));
        intent.putExtra(WebViewActivity.EXTRA_FROM_SHORTCUT, shortcut != null);
        startActivity(intent);
        finish();
    }

    private String buildUrl(String shortcut) {
        String base = getString(R.string.start_url);
        if (shortcut == null) return base;

        switch (shortcut) {
            case "telemetry":
                return withFragment(base, "telemetry");
            case "defense":
                return withFragment(base, "command-center");
            case "analytics":
                return withFragment(base, "analytics");
            case "settings":
                return settingsUrl(base);
            case "overview":
            default:
                return base;
        }
    }

    private static String withFragment(String base, String fragment) {
        return Uri.parse(base).buildUpon().fragment(fragment).build().toString();
    }

    private static String settingsUrl(String base) {
        Uri uri = Uri.parse(base);
        String path = uri.getPath();
        if (path == null || path.isEmpty()) path = "/";
        if (!path.endsWith("/")) path = path + "/";
        path = path + "settings.html";
        return uri.buildUpon().path(path).fragment(null).build().toString();
    }

    /**
     * Canlı siteyi Chrome Custom Tabs içinde açar. Google ile giriş ve web push
     * bu yolda çalışır; yerel WebView oturumundan ayrı bir oturumdur.
     */
    public static void openInChrome(Activity activity, String url) {
        if (url == null || url.trim().isEmpty()) {
            url = activity.getString(R.string.start_url);
        }

        try {
            String browser = findBrowser(activity);
            CustomTabsIntent.Builder builder = new CustomTabsIntent.Builder();
            builder.setShowTitle(true);
            builder.setUrlBarHidingEnabled(true);
            builder.setToolbarColor(Color.parseColor("#0A0D14"));
            builder.setNavigationBarColor(Color.parseColor("#0A0D14"));
            CustomTabsIntent intent = builder.build();
            if (browser != null) {
                intent.intent.setPackage(browser);
            }
            intent.launchUrl(activity, Uri.parse(url));
        } catch (Throwable first) {
            try {
                activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (ActivityNotFoundException second) {
                Toast.makeText(activity,
                        "Açılacak tarayıcı bulunamadı.", Toast.LENGTH_LONG).show();
            }
        }
    }

    private static String findBrowser(Context context) {
        try {
            context.getPackageManager().getPackageInfo("com.android.chrome", 0);
            return "com.android.chrome";
        } catch (Throwable ignored) {
            // Chrome yok veya sorgulanamıyor; Custom Tabs destekli başka tarayıcı ara.
        }
        try {
            return CustomTabsClient.getPackageName(context, null);
        } catch (Throwable ignored) {
            return null;
        }
    }
}
