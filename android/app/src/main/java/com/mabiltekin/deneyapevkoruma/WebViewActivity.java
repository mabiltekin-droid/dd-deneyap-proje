package com.mabiltekin.deneyapevkoruma;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.concurrent.Executor;

/**
 * Yerel uygulama kabuğu.
 *
 * <p>Canlı PWA'yı adres çubuğu olmadan WebView içinde açar. Uygulamaya özel
 * yerel menü, aşağı çekerek yenileme, çift geri tuşu ve Android kısayolları
 * bu sınıfta yönetilir.</p>
 */
public class WebViewActivity extends FragmentActivity {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_FROM_SHORTCUT = "from_shortcut";
    public static final String EXTRA_FROM_NOTIFICATION = "from_notification";

    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1002;
    private static final int LOCATION_PERMISSION_REQUEST = 1003;
    private static final String BRIDGE_NAME = "AndroidApp";

    /** FCM token'ı sayfaya iletmek için açık WebView'a zayıf referans. */
    private static WeakReference<WebViewActivity> INSTANCE = new WeakReference<>(null);

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private LinearLayout errorView;
    private TextView errorText;
    private ValueCallback<Uri[]> filePathCallback;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;
    private String startUrl;
    private long lastBackPress = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        startUrl = getIntent().getStringExtra(EXTRA_URL);
        if (startUrl == null || startUrl.trim().isEmpty()) {
            startUrl = getString(R.string.start_url);
        }

        INSTANCE = new WeakReference<>(this);
        AppNotifications.ensureChannels(this);
        ensureFcmToken();

        Window window = getWindow();
        window.setStatusBarColor(Color.parseColor("#0A0D14"));
        window.setNavigationBarColor(Color.parseColor("#0A0D14"));
        WindowCompat.setDecorFitsSystemWindows(window, false);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0A0D14"));
        setContentView(root);

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(0, bars.top, 0, Math.max(bars.bottom, ime.bottom));
            return insets;
        });

        swipeRefresh = new SwipeRefreshLayout(this);
        swipeRefresh.setBackgroundColor(Color.parseColor("#0A0D14"));
        swipeRefresh.setColorSchemeColors(
                Color.parseColor("#38BDF8"),
                Color.parseColor("#10B981"),
                Color.parseColor("#F59E0B"));
        swipeRefresh.setProgressBackgroundColorSchemeColor(Color.parseColor("#111827"));
        swipeRefresh.setDistanceToTriggerSync(dp(72));
        root.addView(swipeRefresh, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0A0D14"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setNestedScrollingEnabled(true);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        swipeRefresh.addView(webView, new SwipeRefreshLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setOffscreenPreRaster(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setBlockNetworkImage(false);
        settings.setSafeBrowsingEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setGeolocationEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.clearCache(true);
        settings.setUserAgentString(settings.getUserAgentString()
                + " DeneyapEvKoruma/" + appVersion());

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        swipeRefresh.setOnRefreshListener(() -> {
            if (webView != null) {
                showWebContent();
                webView.reload();
            }
        });
        swipeRefresh.setOnChildScrollUpCallback((parent, child) ->
                webView != null && webView.getScrollY() > 0);

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgress(0);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(3));
        progressParams.gravity = Gravity.TOP;
        root.addView(progressBar, progressParams);

        buildErrorView(root);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUri(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUri(Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
                if (errorView.getVisibility() != View.VISIBLE) {
                    showWebContent();
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
                if (errorView.getVisibility() != View.VISIBLE) {
                    webView.setVisibility(View.VISIBLE);
                }
                view.evaluateJavascript(
                        "var style = document.createElement('style');" +
                        "style.innerHTML = '.quake-radar { display: grid !important; width: 130px !important; height: 130px !important; margin: 0.8rem auto 0.4rem !important; } .quake-map { display: inline-flex !important; } svg { max-width: 100%; height: auto; } .quake-btn svg, .quake-disclaimer svg, .quake-item-meta svg, .quake-map svg { width: 16px !important; height: 16px !important; flex: 0 0 auto !important; } .quake-empty svg { width: 32px !important; height: 32px !important; flex: 0 0 auto !important; }';" +
                        "document.head.appendChild(style);",
                        null
                );
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) {
                    showError("Sayfa yüklenemedi.\n\n"
                            + error.getDescription()
                            + "\nKod: " + error.getErrorCode()
                            + "\n" + request.getUrl());
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                if (newProgress >= 100) {
                    progressBar.setVisibility(View.GONE);
                    swipeRefresh.setRefreshing(false);
                } else {
                    progressBar.setVisibility(View.VISIBLE);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    Toast.makeText(WebViewActivity.this,
                            "Dosya seçici bulunamadı", Toast.LENGTH_LONG).show();
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                                                           GeolocationPermissions.Callback callback) {
                if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                        != PackageManager.PERMISSION_GRANTED) {
                    pendingGeoCallback = callback;
                    pendingGeoOrigin = origin;
                    requestPermissions(new String[]{
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                    }, LOCATION_PERMISSION_REQUEST);
                } else {
                    callback.invoke(origin, true, false);
                }
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimetype);
                request.addRequestHeader("User-Agent", userAgent);
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS,
                        URLUtil.guessFileName(url, contentDisposition, mimetype));
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm != null) {
                    dm.enqueue(request);
                    Toast.makeText(this, "İndirme başladı", Toast.LENGTH_SHORT).show();
                }
            } catch (Exception e) {
                Toast.makeText(this,
                        "İndirme başlatılamadı: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });

        webView.addJavascriptInterface(new AndroidBridge(), BRIDGE_NAME);
        webView.loadUrl(startUrl);
    }

    private void buildErrorView(FrameLayout root) {
        errorView = new LinearLayout(this);
        errorView.setOrientation(LinearLayout.VERTICAL);
        errorView.setGravity(Gravity.CENTER);
        errorView.setPadding(dp(24), dp(24), dp(24), dp(24));
        errorView.setBackgroundColor(Color.parseColor("#0A0D14"));
        errorView.setVisibility(View.GONE);

        TextView title = new TextView(this);
        title.setText("Bağlantı kurulamadı");
        title.setTextColor(Color.WHITE);
        title.setTextSize(20);
        title.setGravity(Gravity.CENTER);
        errorView.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        errorText = new TextView(this);
        errorText.setTextColor(Color.parseColor("#94A3B8"));
        errorText.setTextSize(14);
        errorText.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams errorParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        errorParams.topMargin = dp(12);
        errorView.addView(errorText, errorParams);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams buttonRowParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        buttonRowParams.topMargin = dp(20);
        errorView.addView(buttons, buttonRowParams);

        Button retry = new Button(this);
        retry.setText("Tekrar dene");
        retry.setAllCaps(false);
        retry.setTextColor(Color.WHITE);
        retry.setOnClickListener(v -> {
            showWebContent();
            webView.loadUrl(startUrl);
        });
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        retryParams.rightMargin = dp(10);
        buttons.addView(retry, retryParams);

        Button chrome = new Button(this);
        chrome.setText("Chrome'da aç");
        chrome.setAllCaps(false);
        chrome.setTextColor(Color.WHITE);
        chrome.setOnClickListener(v ->
                MainActivity.openInChrome(this, currentUrl()));
        buttons.addView(chrome, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        root.addView(errorView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void showWebContent() {
        if (errorView != null) errorView.setVisibility(View.GONE);
        if (swipeRefresh != null) {
            swipeRefresh.setVisibility(View.VISIBLE);
            swipeRefresh.setEnabled(true);
        }
        if (webView != null) webView.setVisibility(View.VISIBLE);
        if (progressBar != null) {
            progressBar.setVisibility(View.VISIBLE);
            progressBar.setProgress(0);
        }
    }

    private void showError(String message) {
        progressBar.setVisibility(View.GONE);
        swipeRefresh.setRefreshing(false);
        swipeRefresh.setEnabled(false);
        swipeRefresh.setVisibility(View.GONE);
        webView.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
        errorText.setText(message);
    }

    private void showAppMenu() {
        final String[] items = {
                "Yenile",
                "Chrome'da aç",
                "Bağlantıyı paylaş",
                "Uygulama hakkında"
        };
        new AlertDialog.Builder(this)
                .setTitle("Uygulama")
                .setItems(items, (dialog, which) -> {
                    switch (which) {
                        case 0:
                            showWebContent();
                            if (webView != null) webView.reload();
                            break;
                        case 1:
                            MainActivity.openInChrome(this, currentUrl());
                            break;
                        case 2:
                            shareCurrentPage();
                            break;
                        case 3:
                            showAboutDialog();
                            break;
                    }
                })
                .show();
    }

    private void showAboutDialog() {
        new AlertDialog.Builder(this)
                .setTitle("DD Ev Koruma")
                .setMessage("Sürüm " + appVersion()
                        + "\n\nCanlı panel: " + startUrl
                        + "\n\nYerel uygulama; veriler hesabınızda ve Deneyap Kart cihazınızda kalır.")
                .setPositiveButton("Tamam", null)
                .show();
    }

    private void shareCurrentPage() {
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, currentUrl());
            startActivity(Intent.createChooser(send, "Bağlantıyı paylaş"));
        } catch (Throwable t) {
            Toast.makeText(this, "Paylaşım açılamadı", Toast.LENGTH_SHORT).show();
        }
    }

    private String currentUrl() {
        String url = webView != null ? webView.getUrl() : null;
        if (url == null || url.startsWith("about:")) return startUrl;
        return url;
    }

    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Throwable t) {
            return "2.23.0";
        }
    }

    /** FCM token'ını alır; hazır olunca sayfaya iletir. */
    private void ensureFcmToken() {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null) return;
                String token = task.getResult();
                AppNotifications.prefs(this).edit()
                        .putString(AppNotifications.KEY_FCM_TOKEN, token)
                        .apply();
                notifyFcmToken(token);
            });
        } catch (Throwable ignored) {
            // Google Play Hizmetleri yoksa uygulama web bildirimleriyle devam eder.
        }
    }

    /** FCM servisi token yenilediğinde açık sayfayı bilgilendirir. */
    static void notifyFcmToken(final String token) {
        final WebViewActivity activity = INSTANCE.get();
        if (activity == null || token == null) return;
        activity.runOnUiThread(() -> activity.evaluateJs(
                "window.DeneyapNative&&window.DeneyapNative.onFcmToken&&"
                        + "window.DeneyapNative.onFcmToken(" + JSONObject.quote(token) + ");"));
    }

    private void evaluateJs(String js) {
        if (webView == null) return;
        try {
            webView.evaluateJavascript(js, null);
        } catch (Throwable ignored) {
            // Sayfa henüz hazır değilse sonraki çağrıda denenir.
        }
    }

    private String permissionState() {
        if (AppNotifications.hasPermission(this)) return "granted";
        if (Build.VERSION.SDK_INT >= 33) {
            boolean asked = AppNotifications.prefs(this)
                    .getBoolean(AppNotifications.KEY_NOTIF_ASKED, false);
            boolean rationale = shouldShowRequestPermissionRationale(
                    Manifest.permission.POST_NOTIFICATIONS);
            if (asked && !rationale) return "denied";
            return "default";
        }
        return "denied";
    }

    private boolean handleUri(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String host = uri.getHost() == null ? "" : uri.getHost();

        if (scheme.equals("http") || scheme.equals("https")) {
            if (host.equals("ddproje.vercel.app")
                    || host.endsWith(".vercel.app")
                    || host.equals("accounts.google.com")
                    || host.endsWith(".google.com")
                    || host.endsWith(".googleapis.com")
                    || host.endsWith(".googleusercontent.com")
                    || host.endsWith(".firebaseapp.com")
                    || host.endsWith(".firebase.com")
                    || host.endsWith(".github.com")
                    || host.endsWith(".githubusercontent.com")) {
                return false;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException e) {
                Toast.makeText(this, "Bağlantı açılamadı", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        if (scheme.equals("tel")) {
            try {
                startActivity(new Intent(Intent.ACTION_DIAL, uri));
            } catch (ActivityNotFoundException e) {
                Toast.makeText(this, "Arama uygulaması bulunamadı", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        if (scheme.equals("mailto")) {
            try {
                startActivity(new Intent(Intent.ACTION_SENDTO, uri));
            } catch (ActivityNotFoundException e) {
                Toast.makeText(this, "E-posta uygulaması bulunamadı", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Bağlantı açılamadı", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private class AndroidBridge {
        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public String version() {
            return appVersion();
        }

        @JavascriptInterface
        public void haptic() {
            runOnUiThread(() -> {
                if (webView != null) {
                    webView.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
                }
            });
        }

        @JavascriptInterface
        public void openMenu() {
            runOnUiThread(WebViewActivity.this::showAppMenu);
        }

        @JavascriptInterface
        public void openInChrome() {
            runOnUiThread(() ->
                    MainActivity.openInChrome(WebViewActivity.this, currentUrl()));
        }

        @JavascriptInterface
        public void reloadPage() {
            runOnUiThread(() -> {
                if (webView != null) {
                    showWebContent();
                    webView.reload();
                }
            });
        }

        @JavascriptInterface
        public void sharePage() {
            runOnUiThread(WebViewActivity.this::shareCurrentPage);
        }

        /* ------------------------------------------------ FCM / bildirimler */

        @JavascriptInterface
        public String fcmToken() {
            String token = AppNotifications.prefs(WebViewActivity.this)
                    .getString(AppNotifications.KEY_FCM_TOKEN, "");
            if (token == null || token.trim().isEmpty()) {
                ensureFcmToken();
            }
            return token == null ? "" : token;
        }

        @JavascriptInterface
        public String notificationPermission() {
            return permissionState();
        }

        @JavascriptInterface
        public boolean requestNotifications() {
            if (AppNotifications.hasPermission(WebViewActivity.this)) return true;
            runOnUiThread(() -> AppNotifications.requestPermission(
                    WebViewActivity.this, NOTIFICATION_PERMISSION_REQUEST));
            return false;
        }

        @JavascriptInterface
        public boolean statusNotificationEnabled() {
            return AppNotifications.statusEnabled(WebViewActivity.this);
        }

        @JavascriptInterface
        public void authenticate(final String callbackId) {
            runOnUiThread(() -> {
                try {
                    BiometricManager biometricManager = BiometricManager.from(WebViewActivity.this);
                    if (biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                            != BiometricManager.BIOMETRIC_SUCCESS) {
                        if (webView != null) {
                            webView.evaluateJavascript("window._onBiometricResult && window._onBiometricResult('" + callbackId + "', true, 'Biyometrik kilit devrede değil');", null);
                        }
                        return;
                    }

                    Executor executor = ContextCompat.getMainExecutor(WebViewActivity.this);
                    BiometricPrompt biometricPrompt = new BiometricPrompt((FragmentActivity) WebViewActivity.this,
                            executor, new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                            super.onAuthenticationError(errorCode, errString);
                            if (webView != null) {
                                webView.evaluateJavascript("window._onBiometricResult && window._onBiometricResult('" + callbackId + "', false, '" + errString.toString().replace("'", "\\'") + "');", null);
                            }
                        }

                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            super.onAuthenticationSucceeded(result);
                            if (webView != null) {
                                webView.evaluateJavascript("window._onBiometricResult && window._onBiometricResult('" + callbackId + "', true, 'Doğrulama başarılı');", null);
                            }
                        }
                    });

                    BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                            .setTitle("DD Ev Koruma Güvenlik Doğrulaması")
                            .setSubtitle("Hassas komutu onaylamak için parmak izinizi okutun")
                            .setNegativeButtonText("İptal")
                            .build();

                    biometricPrompt.authenticate(promptInfo);
                } catch (Throwable t) {
                    if (webView != null) {
                        webView.evaluateJavascript("window._onBiometricResult && window._onBiometricResult('" + callbackId + "', true, 'Hata');", null);
                    }
                }
            });
        }

        /**
         * Sürekli durum bildirimini açar/günceller.
         * { enabled, title, body, big, url }
         */
        @JavascriptInterface
        public void setStatusNotification(String json) {
            final String raw = json == null ? "{}" : json;
            runOnUiThread(() -> {
                try {
                    JSONObject o = new JSONObject(raw);
                    boolean enabled = o.optBoolean("enabled", true);
                    AppNotifications.setStatusEnabled(WebViewActivity.this, enabled);
                    if (enabled) {
                        AppNotifications.showStatus(WebViewActivity.this,
                                o.optString("title", "Sistem durumu"),
                                o.optString("body", "Son durum"),
                                o.optString("big", ""),
                                o.optString("url", getString(R.string.start_url)));
                    }
                } catch (Throwable ignored) {
                    // Geçersiz JSON: bildirim değiştirilmez.
                }
            });
        }

        /** Ana ekran widget'ına son durumu yazar. */
        @JavascriptInterface
        public void setWidgetStatus(String json) {
            final String raw = json == null ? "{}" : json;
            runOnUiThread(() -> {
                try {
                    JSONObject o = new JSONObject(raw);
                    StatusWidgetProvider.saveStatus(WebViewActivity.this,
                            o.optString("status", ""),
                            o.optString("detail", ""),
                            o.optBoolean("ok", false));
                } catch (Throwable ignored) {
                    // yoksay
                }
            });
        }

        /** Olay raporunu PDF olarak üretip paylaşım sayfasını açar. */
        @JavascriptInterface
        public void exportPdf(String json) {
            final String raw = json == null ? "{}" : json;
            runOnUiThread(() -> ReportPdf.share(WebViewActivity.this, raw));
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            runOnUiThread(() -> AppNotifications.openChannelSettings(WebViewActivity.this));
        }

        /** 112 Acil Yardım veya belirtilen numarayı arama ekranında açar. */
        @JavascriptInterface
        public void callEmergency(String number) {
            final String target = (number == null || number.trim().isEmpty()) ? "112" : number.trim();
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + target));
                    startActivity(intent);
                } catch (Throwable t) {
                    Toast.makeText(WebViewActivity.this, "Arama açılamadı: " + target, Toast.LENGTH_SHORT).show();
                }
            });
        }

        /** Cihazda biyometrik kilit (parmak izi/yüz tanıma) kullanılabilir mi? */
        @JavascriptInterface
        public boolean canAuthenticateBiometric() {
            try {
                BiometricManager bm = BiometricManager.from(WebViewActivity.this);
                return bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG
                        | BiometricManager.Authenticators.BIOMETRIC_WEAK
                        | BiometricManager.Authenticators.DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS;
            } catch (Throwable t) {
                return false;
            }
        }

        /** Biyometrik kimlik doğrulamayı başlatır. */
        @JavascriptInterface
        public void authenticateBiometric(String title, String subtitle) {
            final String promptTitle = (title == null || title.trim().isEmpty()) ? "Kimlik Doğrulama" : title;
            final String promptSub = (subtitle == null) ? "İşleme devam etmek için doğrulayın" : subtitle;
            runOnUiThread(() -> showBiometricPrompt(promptTitle, promptSub));
        }
    }

    private void showBiometricPrompt(String title, String subtitle) {
        try {
            Executor executor = ContextCompat.getMainExecutor(this);
            BiometricPrompt prompt = new BiometricPrompt(this, executor,
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            super.onAuthenticationSucceeded(result);
                            evaluateJs("window.DeneyapNative&&window.DeneyapNative.onBiometricResult&&"
                                    + "window.DeneyapNative.onBiometricResult(true, null);");
                        }

                        @Override
                        public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                            super.onAuthenticationError(errorCode, errString);
                            evaluateJs("window.DeneyapNative&&window.DeneyapNative.onBiometricResult&&"
                                    + "window.DeneyapNative.onBiometricResult(false, "
                                    + JSONObject.quote(errString.toString()) + ");");
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            super.onAuthenticationFailed();
                        }
                    });

            BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG
                            | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                    .build();

            prompt.authenticate(promptInfo);
        } catch (Throwable t) {
            evaluateJs("window.DeneyapNative&&window.DeneyapNative.onBiometricResult&&"
                    + "window.DeneyapNative.onBiometricResult(false, "
                    + JSONObject.quote("Biyometrik doğrulama başlatılamadı: " + t.getMessage()) + ");");
        }
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = intent.getStringExtra(EXTRA_URL);
        boolean fromShortcut = intent.getBooleanExtra(EXTRA_FROM_SHORTCUT, false);
        boolean fromNotification = intent.getBooleanExtra(EXTRA_FROM_NOTIFICATION, false);
        if ((fromShortcut || fromNotification)
                && url != null && !url.trim().isEmpty() && webView != null) {
            startUrl = url;
            showWebContent();
            webView.loadUrl(url);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK && data != null) {
                    result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                }
                filePathCallback.onReceiveValue(result);
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) {
            evaluateJs("window.DeneyapNative&&window.DeneyapNative.onPermission&&"
                    + "window.DeneyapNative.onPermission("
                    + JSONObject.quote(permissionState()) + ");");
        } else if (requestCode == LOCATION_PERMISSION_REQUEST) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (pendingGeoCallback != null) {
                pendingGeoCallback.invoke(pendingGeoOrigin, granted, false);
                pendingGeoCallback = null;
                pendingGeoOrigin = null;
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackPress <= 2200) {
            super.onBackPressed();
        } else {
            lastBackPress = now;
            Toast.makeText(this, "Çıkmak için tekrar geri basın", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        INSTANCE = new WeakReference<>(null);
        if (webView != null) {
            webView.removeJavascriptInterface(BRIDGE_NAME);
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
