package com.mabiltekin.deneyapevkoruma;

import android.app.Activity;
import android.net.Uri;
import android.util.Log;
import android.webkit.WebView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.util.Collections;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Connects the panel's Google sign-in button to Chrome Custom Tabs
 * and routes the deneyapevkoruma://auth-callback return URI back to the WebView.
 */
final class GoogleSignInBridge {
    private static final String LOG_TAG = "DDGoogleSignIn";
    private static final String PORT_NAME = "DeneyapGooglePort";
    private static final String REQUEST_BROWSER = "startBrowserSignIn";
    private static final Pattern STATE_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{16,80}$");
    private static final Pattern CODE_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{16,120}$");

    private static final String SCRIPT = """
            (() => {
              const port = window.DeneyapGooglePort;
              if (window !== window.top || !port || window.DeneyapGoogleSignIn) return;
              let pending;
              port.onmessage = ({data}) => {
                const reply = JSON.parse(data);
                const request = pending;
                if (!request || request.id !== reply.id) return;
                pending = null;
                clearTimeout(request.timer);
                if (reply.code && reply.state) request.resolve({code: reply.code, state: reply.state});
                else request.reject(Object.assign(
                  new Error(reply.error || 'Google girişi tamamlanamadı.'),
                  {code: reply.errorCode || reply.code || 'auth/native-sign-in-failed'}
                ));
              };
              let nextRequestId = 0;
              window.DeneyapGoogleSignIn = Object.freeze({
                startBrowserSignIn(state) {
                  const cleanState = String(state || '');
                  if (!/^[A-Za-z0-9_-]{16,80}$/.test(cleanState)) {
                    return Promise.reject(Object.assign(
                      new Error('Geçersiz oturum durumu.'),
                      {code: 'auth/invalid-state'}
                    ));
                  }
                  if (pending) return Promise.reject(new Error('Google girişi zaten açık.'));
                  return new Promise((resolve, reject) => {
                    const id = String(++nextRequestId);
                    const timer = setTimeout(() => {
                      pending = null;
                      try { port.postMessage('cancelGoogleSignIn:' + id); } catch {}
                      reject(Object.assign(
                        new Error('Google girişinden yanıt alınamadı. Tekrar deneyin.'),
                        {code: 'auth/native-sign-in-timeout'}
                      ));
                    }, 180000);
                    pending = {id, timer, resolve, reject};
                    try {
                      port.postMessage('startBrowserSignIn:' + id + ':' + cleanState);
                    } catch (error) {
                      clearTimeout(timer);
                      pending = null;
                      reject(error);
                    }
                  });
                }
              });
            })();
            """;

    private final Activity activity;
    private final WebView webView;
    private final String startUrl;
    private final URI origin;
    private final boolean injectOnPageFinished;

    private record Request(String id, String state, JavaScriptReplyProxy reply) {}
    private Request pending;

    GoogleSignInBridge(Activity activity, WebView webView, String startUrl) {
        this.activity = activity;
        this.webView = webView;
        this.startUrl = startUrl;
        origin = parseUrl(startUrl);
        if (webView == null || !isHttpsOrigin(origin)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            injectOnPageFinished = false;
            return;
        }

        boolean pageFinishedFallback = false;
        try {
            int port = httpsPort(origin);
            String originRule = "https://" + origin.getHost() + (port == 443 ? "" : ":" + port);
            Set<String> origins = Collections.singleton(originRule);
            WebViewCompat.addWebMessageListener(webView, PORT_NAME, origins,
                    (view, message, source, isMainFrame, reply) -> {
                        try {
                            if (!isMainFrame || source == null || view == null
                                    || !matchesOrigin(source.toString()) || !matchesOrigin(view.getUrl())
                                    || message == null
                                    || message.getType() != androidx.webkit.WebMessageCompat.TYPE_STRING) return;
                            String data = message.getData();
                            if (data == null || data.length() > 140) return;
                            String[] parts = data.split(":", 3);
                            if (parts.length == 3 && REQUEST_BROWSER.equals(parts[0])
                                    && parts[1].matches("[0-9]{1,12}")
                                    && STATE_PATTERN.matcher(parts[2]).matches()) {
                                startBrowserSignIn(parts[1], parts[2], reply);
                            } else if (parts.length >= 2 && "cancelGoogleSignIn".equals(parts[0])
                                    && parts[1].matches("[0-9]{1,12}")
                                    && pending != null && pending.id().equals(parts[1])) {
                                cancel();
                            }
                        } catch (Throwable t) {
                            Log.w(LOG_TAG, "web_message_failed", t);
                        }
                    });
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(webView, SCRIPT, origins);
            } else {
                pageFinishedFallback = true;
            }
        } catch (Throwable t) {
            Log.w(LOG_TAG, "bridge_init_failed", t);
            pageFinishedFallback = false;
        }
        injectOnPageFinished = pageFinishedFallback;
    }

    private boolean isActivityAlive() {
        return activity != null && !activity.isFinishing() && !activity.isDestroyed();
    }

    void onPageFinished(String url) {
        if (!injectOnPageFinished || !isActivityAlive() || webView == null) return;
        if (matchesOrigin(url)) {
            try {
                webView.evaluateJavascript(SCRIPT, null);
            } catch (Throwable t) {
                Log.w(LOG_TAG, "page_finished_inject_failed", t);
            }
        }
    }

    void cancel() {
        Request req = pending;
        pending = null;
        if (req != null) {
            Log.d(LOG_TAG, "request_closed");
        }
    }

    private String buildBrowserAuthUrl(String state) {
        Uri base = Uri.parse(startUrl != null ? startUrl : ("https://" + origin.getHost() + "/"));
        String path = base.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) {
            path = "/settings.html";
        } else if (path.endsWith("/")) {
            path = path + "settings.html";
        } else if (!path.endsWith("settings.html") && !path.endsWith("settings")) {
            path = "/settings.html";
        }
        return base.buildUpon()
                .path(path)
                .clearQuery()
                .appendQueryParameter("native_auth", "google")
                .appendQueryParameter("state", state)
                .appendQueryParameter("return", "app")
                .fragment("accountCard")
                .build()
                .toString();
    }

    private void startBrowserSignIn(String id, String state, JavaScriptReplyProxy reply) {
        if (!isActivityAlive()) {
            Log.d(LOG_TAG, "activity_not_alive");
            return;
        }
        if (pending != null) {
            postErrorReply(id, reply, "Google girişi zaten açık.", "auth/native-sign-in-busy");
            return;
        }
        pending = new Request(id, state, reply);
        Log.d(LOG_TAG, "browser_signin_started");
        try {
            String authUrl = buildBrowserAuthUrl(state);
            activity.runOnUiThread(() -> {
                if (!isActivityAlive()) return;
                MainActivity.openInChrome(activity, authUrl);
            });
        } catch (Throwable t) {
            Log.w(LOG_TAG, "browser_launch_failed", t);
            if (pending != null && id.equals(pending.id())) {
                pending = null;
            }
            postErrorReply(id, reply, "Google girişi tarayıcıda açılamadı.", "auth/native-request-failed");
        }
    }

    void onAuthCallback(Uri uri) {
        if (uri == null || !isActivityAlive()) return;
        String code = uri.getQueryParameter("code");
        String state = uri.getQueryParameter("state");
        if (code == null || !CODE_PATTERN.matcher(code).matches()
                || state == null || !STATE_PATTERN.matcher(state).matches()) {
            Log.w(LOG_TAG, "callback_invalid_params");
            return;
        }
        activity.runOnUiThread(() -> {
            if (!isActivityAlive() || webView == null) return;
            Request req = pending;
            if (req != null && state.equals(req.state())) {
                pending = null;
                postCallbackReply(req, code, state);
            }
            String currentUrl;
            try {
                currentUrl = webView.getUrl();
            } catch (Throwable ignored) {
                return;
            }
            if (matchesOrigin(currentUrl)) {
                try {
                    webView.evaluateJavascript(
                            "window.DeneyapNative&&window.DeneyapNative.onAuthCallback&&"
                                    + "window.DeneyapNative.onAuthCallback("
                                    + JSONObject.quote(code) + "," + JSONObject.quote(state) + ");",
                            null);
                } catch (Throwable t) {
                    Log.w(LOG_TAG, "callback_js_eval_failed", t);
                }
            }
        });
    }

    private void postCallbackReply(Request request, String code, String state) {
        if (!isActivityAlive() || webView == null || request.reply() == null) return;
        String currentUrl;
        try {
            currentUrl = webView.getUrl();
        } catch (Throwable ignored) {
            return;
        }
        if (!matchesOrigin(currentUrl)) {
            Log.d(LOG_TAG, "reply_origin_changed");
            return;
        }
        try {
            request.reply().postMessage(new JSONObject()
                    .put("id", request.id())
                    .put("code", code)
                    .put("state", state)
                    .toString());
            Log.d(LOG_TAG, "browser_callback_sent");
        } catch (JSONException ignored) {
            Log.d(LOG_TAG, "reply_format_failed");
        } catch (Throwable ignored) {
            Log.d(LOG_TAG, "reply_channel_closed");
        }
    }

    private void postErrorReply(String id, JavaScriptReplyProxy reply, String error, String errorCode) {
        if (!isActivityAlive() || webView == null || reply == null) return;
        String currentUrl;
        try {
            currentUrl = webView.getUrl();
        } catch (Throwable ignored) {
            return;
        }
        if (!matchesOrigin(currentUrl)) return;
        try {
            reply.postMessage(new JSONObject()
                    .put("id", id)
                    .put("error", error)
                    .put("errorCode", errorCode)
                    .toString());
        } catch (Throwable ignored) {
            Log.d(LOG_TAG, "error_reply_failed");
        }
    }

    private boolean matchesOrigin(String url) {
        URI uri = parseUrl(url);
        return isHttpsOrigin(uri) && uri.getHost().equalsIgnoreCase(origin.getHost())
                && httpsPort(uri) == httpsPort(origin);
    }

    private static URI parseUrl(String url) {
        if (url == null) return null;
        try {
            return URI.create(url);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private static boolean isHttpsOrigin(URI uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme())
                && uri.getRawUserInfo() == null && uri.getHost() != null;
    }

    private static int httpsPort(URI uri) {
        return uri.getPort() == -1 ? 443 : uri.getPort();
    }
}
