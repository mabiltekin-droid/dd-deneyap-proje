package com.mabiltekin.deneyapevkoruma;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
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

public class WebViewActivity extends Activity {

    public static final String EXTRA_URL = "url";
    private static final int FILE_CHOOSER_REQUEST = 1001;

    private WebView webView;
    private ProgressBar progressBar;
    private LinearLayout errorView;
    private TextView errorText;
    private ValueCallback<Uri[]> filePathCallback;
    private String startUrl;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        startUrl = getIntent().getStringExtra(EXTRA_URL);
        if (startUrl == null || startUrl.trim().isEmpty()) {
            startUrl = getString(R.string.start_url);
        }

        Window window = getWindow();
        window.setStatusBarColor(Color.parseColor("#0A0D14"));
        window.setNavigationBarColor(Color.parseColor("#0A0D14"));

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0A0D14"));
        setContentView(root);

        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " DeneyapEvKoruma/2.21.0");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgress(0);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(3));
        progressParams.gravity = Gravity.TOP;
        root.addView(progressBar, progressParams);

        errorView = new LinearLayout(this);
        errorView.setOrientation(LinearLayout.VERTICAL);
        errorView.setGravity(Gravity.CENTER);
        errorView.setPadding(dp(24), dp(24), dp(24), dp(24));
        errorView.setBackgroundColor(Color.parseColor("#0A0D14"));
        errorView.setVisibility(View.GONE);

        errorText = new TextView(this);
        errorText.setTextColor(Color.WHITE);
        errorText.setTextSize(15);
        errorText.setGravity(Gravity.CENTER);
        errorView.addView(errorText, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        Button retry = new Button(this);
        retry.setText("Tekrar dene");
        retry.setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            webView.setVisibility(View.VISIBLE);
            progressBar.setVisibility(View.VISIBLE);
            webView.loadUrl(startUrl);
        });
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        retryParams.topMargin = dp(16);
        errorView.addView(retry, retryParams);

        root.addView(errorView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUri(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
                if (errorView.getVisibility() != View.VISIBLE) {
                    webView.setVisibility(View.VISIBLE);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
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
                progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
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

        webView.loadUrl(startUrl);
    }

    private boolean handleUri(Uri uri) {
        if (uri == null) {
            return false;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String host = uri.getHost() == null ? "" : uri.getHost();

        if (scheme.equals("http") || scheme.equals("https")) {
            if (host.equals("ddproje.vercel.app")
                    || host.endsWith(".vercel.app")
                    || host.equals("accounts.google.com")
                    || host.endsWith(".google.com")
                    || host.endsWith(".googleapis.com")
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

        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Bağlantı açılamadı", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void showError(String message) {
        progressBar.setVisibility(View.GONE);
        webView.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
        errorText.setText(message);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
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
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
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
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
