package com.mabiltekin.deneyapevkoruma;

import android.app.Activity;
import android.os.CancellationSignal;
import android.util.Log;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.GetCredentialInterruptedException;
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException;
import androidx.credentials.exceptions.GetCredentialUnsupportedException;
import androidx.credentials.exceptions.NoCredentialException;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.util.Collections;
import java.util.Set;

/** Connects the panel's Google sign-in button to Android Credential Manager. */
final class GoogleSignInBridge {
    private static final String LOG_TAG = "DDGoogleSignIn";
    private static final String PORT_NAME = "DeneyapGooglePort";
    private static final String REQUEST_TOKEN = "getGoogleIdToken";
    private static final String WEB_CLIENT_ID_FALLBACK =
            "849622636824-upf0a7p1kjkks3a5lgbp0lr52uj1jv1b.apps.googleusercontent.com";
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
                if (reply.idToken) request.resolve(reply.idToken);
                else request.reject(Object.assign(new Error(reply.error), {code: reply.code}));
              };
              let nextRequestId = 0;
              window.DeneyapGoogleSignIn = Object.freeze({
                getGoogleIdToken() {
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
                      port.postMessage('getGoogleIdToken:' + id);
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
    private final URI origin;
    private final boolean injectOnPageFinished;
    private record Request(String id, CancellationSignal cancellation) {}
    private Request pending;

    GoogleSignInBridge(Activity activity, WebView webView, String startUrl) {
        this.activity = activity;
        this.webView = webView;
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
                            if (data == null || data.length() > 40) return;
                            String[] parts = data.split(":", 2);
                            if (parts.length != 2 || !parts[1].matches("[0-9]{1,12}")) return;
                            if (REQUEST_TOKEN.equals(parts[0])) requestIdToken(parts[1], reply);
                            else if ("cancelGoogleSignIn".equals(parts[0]) && pending != null
                                    && pending.id().equals(parts[1])) cancel();
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

    private String resolveWebClientId() {
        if (activity != null) {
            try {
                String value = activity.getString(R.string.default_web_client_id);
                if (value != null && !value.trim().isEmpty()) {
                    return value.trim();
                }
            } catch (Throwable ignored) {
                // Debug veya özel derlemelerde kaynak eksik olabilir; yedek istemci kimliği kullanılır.
            }
        }
        return WEB_CLIENT_ID_FALLBACK;
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
        Request request = pending;
        pending = null;
        if (request != null) {
            Log.d(LOG_TAG, "request_closed");
            try {
                request.cancellation().cancel();
            } catch (Throwable ignored) {
                // İptal sinyali temizlenemedi.
            }
        }
    }

    private void requestIdToken(String id, JavaScriptReplyProxy reply) {
        Request request = new Request(id, new CancellationSignal());
        if (!isActivityAlive()) {
            Log.d(LOG_TAG, "activity_not_alive");
            return;
        }
        if (pending != null) {
            postReply(request, reply, "error", "Google girişi zaten açık.",
                    "auth/native-sign-in-busy");
            return;
        }
        pending = request;
        Log.d(LOG_TAG, "credential_requested");
        try {
            activity.runOnUiThread(() -> startCredentialRequest(request, reply, true));
        } catch (Throwable t) {
            Log.w(LOG_TAG, "credential_dispatch_failed", t);
            finish(request, reply, "error", "Google girişi bu cihazda başlatılamadı.",
                    "auth/native-request-failed");
        }
    }

    private void startCredentialRequest(Request request, JavaScriptReplyProxy reply,
                                        boolean useSignInWithGoogleOption) {
        if (!isActivityAlive()) {
            if (pending == request) pending = null;
            return;
        }
        if (pending != request || request.cancellation().isCanceled()) return;
        try {
            String clientId = resolveWebClientId();
            GetCredentialRequest.Builder builder = new GetCredentialRequest.Builder();
            if (useSignInWithGoogleOption) {
                builder.addCredentialOption(new GetSignInWithGoogleOption.Builder(clientId).build());
            } else {
                builder.addCredentialOption(new GetGoogleIdOption.Builder()
                        .setFilterByAuthorizedAccounts(false)
                        .setServerClientId(clientId)
                        .setAutoSelectEnabled(false)
                        .build());
            }
            CredentialManager.create(activity).getCredentialAsync(activity, builder.build(),
                    request.cancellation(),
                    ContextCompat.getMainExecutor(activity),
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override
                        public void onResult(GetCredentialResponse result) {
                            try {
                                if (!isActivityAlive()) {
                                    if (pending == request) pending = null;
                                    return;
                                }
                                if (result != null && result.getCredential() instanceof CustomCredential credential
                                        && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                                        .equals(credential.getType())) {
                                    String token = GoogleIdTokenCredential
                                            .createFrom(credential.getData()).getIdToken();
                                    if (token != null && !token.isEmpty()) {
                                        finish(request, reply, "idToken", token, "");
                                        return;
                                    }
                                }
                            } catch (Throwable t) {
                                Log.w(LOG_TAG, "credential_result_failed", t);
                            }
                            finish(request, reply, "error", "Google hesabı doğrulanamadı.",
                                    "auth/invalid-credential");
                        }

                        @Override
                        public void onError(GetCredentialException error) {
                            try {
                                if (!isActivityAlive()) {
                                    if (pending == request) pending = null;
                                    return;
                                }
                                Log.w(LOG_TAG, "credential_error:" + (error != null ? error.getClass().getSimpleName() : "null"), error);
                                if (useSignInWithGoogleOption && shouldRetryWithGoogleIdOption(error)
                                        && pending == request && !request.cancellation().isCanceled()) {
                                    startCredentialRequest(request, reply, false);
                                    return;
                                }
                                finishWithError(request, reply, error);
                            } catch (Throwable t) {
                                Log.w(LOG_TAG, "credential_error_handler_failed", t);
                                finish(request, reply, "error", "Google hesabı doğrulanamadı. Tekrar deneyin.",
                                        "auth/native-sign-in-failed");
                            }
                        }
                    });
        } catch (Throwable t) {
            Log.w(LOG_TAG, "credential_request_failed", t);
            finish(request, reply, "error", "Google girişi bu cihazda başlatılamadı.",
                    "auth/native-request-failed");
        }
    }

    private static boolean shouldRetryWithGoogleIdOption(GetCredentialException error) {
        return error instanceof NoCredentialException
                || error instanceof GetCredentialUnsupportedException
                || error instanceof GetCredentialProviderConfigurationException;
    }

    private void finishWithError(Request request, JavaScriptReplyProxy reply,
                                 GetCredentialException error) {
        if (error instanceof GetCredentialCancellationException) {
            finish(request, reply, "error", "Google girişi iptal edildi.",
                    "auth/cancelled-popup-request");
        } else if (error instanceof NoCredentialException) {
            finish(request, reply, "error", "Kullanılabilir Google hesabı bulunamadı. Telefonunuzdaki Google hesabını kontrol edin.",
                    "auth/no-credential");
        } else if (error instanceof GetCredentialProviderConfigurationException
                || error instanceof GetCredentialUnsupportedException) {
            finish(request, reply, "error", "Google girişi kullanılamıyor. Google Play Hizmetleri’ni güncelleyip tekrar deneyin.",
                    "auth/native-provider-unavailable");
        } else if (error instanceof GetCredentialInterruptedException) {
            finish(request, reply, "error", "Google girişi kesildi. İnternet bağlantınızı kontrol edip tekrar deneyin.",
                    "auth/native-sign-in-interrupted");
        } else {
            finish(request, reply, "error", "Google hesabı doğrulanamadı. Tekrar deneyin.",
                    "auth/native-sign-in-failed");
        }
    }

    private void finish(Request request, JavaScriptReplyProxy reply,
                        String key, String value, String code) {
        if (pending != request) return;
        pending = null;
        postReply(request, reply, key, value, code);
    }

    private void postReply(Request request, JavaScriptReplyProxy reply,
                           String key, String value, String code) {
        if (!isActivityAlive() || webView == null || reply == null) {
            Log.d(LOG_TAG, "reply_target_unavailable");
            return;
        }
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
            reply.postMessage(new JSONObject().put("id", request.id())
                    .put(key, value).put("code", code).toString());
            Log.d(LOG_TAG, code.isEmpty() ? "credential_sent" : code);
        } catch (JSONException ignored) {
            Log.d(LOG_TAG, "reply_format_failed");
        } catch (Throwable ignored) {
            Log.d(LOG_TAG, "reply_channel_closed");
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
