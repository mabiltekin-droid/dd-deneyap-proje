package com.mabiltekin.deneyapevkoruma;

import android.app.Activity;
import android.os.CancellationSignal;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.util.Collections;
import java.util.Set;

/** Connects the panel's Google sign-in button to Android Credential Manager. */
final class GoogleSignInBridge {
    private static final String PORT_NAME = "DeneyapGooglePort";
    private static final String REQUEST_TOKEN = "getGoogleIdToken";
    private static final String SCRIPT = """
            (() => {
              const port = window.DeneyapGooglePort;
              if (window !== window.top || !port || window.DeneyapGoogleSignIn) return;
              let pending;
              port.onmessage = ({data}) => {
                const reply = JSON.parse(data);
                const request = pending;
                pending = null;
                if (!request) return;
                if (reply.idToken) request.resolve(reply.idToken);
                else request.reject(Object.assign(new Error(reply.error), {code: reply.code}));
              };
              window.DeneyapGoogleSignIn = Object.freeze({
                getGoogleIdToken() {
                  if (pending) return Promise.reject(new Error('Google girişi zaten açık.'));
                  return new Promise((resolve, reject) => {
                    pending = {resolve, reject};
                    try {
                      port.postMessage('getGoogleIdToken');
                    } catch (error) {
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
    private CancellationSignal pending;

    GoogleSignInBridge(Activity activity, WebView webView, String startUrl) {
        this.activity = activity;
        this.webView = webView;
        origin = parseUrl(startUrl);
        if (!isHttpsOrigin(origin) || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            injectOnPageFinished = false;
            return;
        }

        Set<String> origins = Collections.singleton("https://" + origin.getHost() + ":" + httpsPort(origin));
        WebViewCompat.addWebMessageListener(webView, PORT_NAME, origins,
                (view, message, source, isMainFrame, reply) -> {
                    if (isMainFrame && matchesOrigin(source.toString()) && matchesOrigin(view.getUrl())
                            && message.getType() == androidx.webkit.WebMessageCompat.TYPE_STRING
                            && REQUEST_TOKEN.equals(message.getData())) {
                        requestIdToken(reply);
                    }
                });
        injectOnPageFinished = !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        if (!injectOnPageFinished) WebViewCompat.addDocumentStartJavaScript(webView, SCRIPT, origins);
    }

    void onPageFinished(String url) {
        if (injectOnPageFinished && matchesOrigin(url)) webView.evaluateJavascript(SCRIPT, null);
    }

    void cancel() {
        CancellationSignal request = pending;
        pending = null;
        if (request != null) request.cancel();
    }

    private void requestIdToken(JavaScriptReplyProxy reply) {
        if (pending != null) return;
        CancellationSignal request = new CancellationSignal();
        pending = request;
        try {
            GetCredentialRequest credentials = new GetCredentialRequest.Builder()
                    .addCredentialOption(new GetSignInWithGoogleOption.Builder(
                            activity.getString(R.string.default_web_client_id)).build())
                    .build();
            CredentialManager.create(activity).getCredentialAsync(activity, credentials, request,
                    ContextCompat.getMainExecutor(activity),
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override
                        public void onResult(GetCredentialResponse result) {
                            if (result.getCredential() instanceof CustomCredential credential
                                    && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                                    .equals(credential.getType())) {
                                try {
                                    String token = GoogleIdTokenCredential
                                            .createFrom(credential.getData()).getIdToken();
                                    finish(request, reply, "idToken", token, "");
                                    return;
                                } catch (RuntimeException ignored) {
                                    // Geçersiz sağlayıcı yanıtı.
                                }
                            }
                            finish(request, reply, "error", "Google hesabı doğrulanamadı.",
                                    "auth/invalid-credential");
                        }

                        @Override
                        public void onError(GetCredentialException error) {
                            if (error instanceof GetCredentialCancellationException) {
                                finish(request, reply, "error", "Google girişi iptal edildi.",
                                        "auth/cancelled-popup-request");
                            } else if (error instanceof NoCredentialException) {
                                finish(request, reply, "error", "Uygun Google hesabı bulunamadı.",
                                        "auth/no-credential");
                            } else {
                                finish(request, reply, "error", "Google girişi başlatılamadı.",
                                        "auth/native-sign-in-failed");
                            }
                        }
                    });
        } catch (RuntimeException ignored) {
            finish(request, reply, "error", "Google girişi bu cihazda başlatılamadı.",
                    "auth/native-sign-in-failed");
        }
    }

    private void finish(CancellationSignal request, JavaScriptReplyProxy reply,
                        String key, String value, String code) {
        if (pending != request) return;
        pending = null;
        if (!matchesOrigin(webView.getUrl())) return;
        try {
            reply.postMessage(new JSONObject().put(key, value).put("code", code).toString());
        } catch (JSONException ignored) {
            // Yanıt yalnızca metin alanları içerir.
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
