package com.mabiltekin.deneyapevkoruma;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.Toast;

import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;

/**
 * Chrome Custom Tabs ile siteyi açar. Chrome yoksa, engelliyse veya Chrome hemen
 * kapanırsa WebViewActivity'ye düşer. Böylece uygulama her durumda açılır.
 */
public class MainActivity extends Activity {

    private static final long RETURN_GRACE_MS = 3000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private String startUrl;
    private boolean launched = false;
    private boolean firstResume = true;
    private boolean paused = false;
    private long launchedAt = 0L;
    private Runnable watchdog;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        startUrl = getString(R.string.start_url);

        getWindow().setStatusBarColor(Color.parseColor("#0A0D14"));
        getWindow().setNavigationBarColor(Color.parseColor("#0A0D14"));

        View background = new View(this);
        background.setBackgroundColor(Color.parseColor("#0A0D14"));
        setContentView(background);

        launchChromeOrWebView();
    }

    private void launchChromeOrWebView() {
        String browser = findBrowser();
        if (browser == null) {
            openWebView();
            return;
        }

        try {
            CustomTabsIntent.Builder builder = new CustomTabsIntent.Builder();
            builder.setShowTitle(true);
            builder.setUrlBarHidingEnabled(true);
            builder.setToolbarColor(Color.parseColor("#0A0D14"));
            builder.setNavigationBarColor(Color.parseColor("#0A0D14"));
            CustomTabsIntent intent = builder.build();
            intent.intent.setPackage(browser);

            launched = true;
            launchedAt = System.currentTimeMillis();
            intent.launchUrl(this, Uri.parse(startUrl));

            watchdog = () -> {
                if (launched && !paused && hasWindowFocus() && !isFinishing()) {
                    launched = false;
                    openWebView();
                }
            };
            handler.postDelayed(watchdog, 3000L);
        } catch (Throwable t) {
            launched = false;
            Toast.makeText(this,
                    "Chrome açılamadı, yerleşik görünüm kullanılacak.",
                    Toast.LENGTH_SHORT).show();
            openWebView();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        paused = false;

        if (firstResume) {
            firstResume = false;
            return;
        }

        if (launched) {
            long elapsed = System.currentTimeMillis() - launchedAt;
            launched = false;
            if (elapsed < RETURN_GRACE_MS) {
                openWebView();
            } else {
                finish();
            }
        }
    }

    @Override
    protected void onPause() {
        paused = true;
        super.onPause();
    }

    private String findBrowser() {
        try {
            getPackageManager().getPackageInfo("com.android.chrome", 0);
            return "com.android.chrome";
        } catch (Throwable ignored) {
            // Chrome yok, görünmüyor veya sorgulanamıyor; başka bir tarayıcı ara.
        }
        try {
            return CustomTabsClient.getPackageName(this, null);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private void openWebView() {
        if (watchdog != null) {
            handler.removeCallbacks(watchdog);
            watchdog = null;
        }
        Intent intent = new Intent(this, WebViewActivity.class);
        intent.putExtra(WebViewActivity.EXTRA_URL, startUrl);
        startActivity(intent);
        finish();
    }

    @Override
    protected void onDestroy() {
        if (watchdog != null) {
            handler.removeCallbacks(watchdog);
            watchdog = null;
        }
        super.onDestroy();
    }
}
