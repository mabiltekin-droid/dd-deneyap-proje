/* ==========================================================================
   supabase.js — Supabase REST / Auth istemcisi (bağımlılıksız)

   Neden kendi istemcisi?
     Panel çevrimdışı da çalışmalı; ayrıca resmî kütüphane CDN'e bağlanır
     ve servis worker önbelleğine girer. Buradaki akış gerçekte üç çağrıdır:
       1) POST /auth/v1/token?grant_type=password      → giriş
       2) POST /auth/v1/token?grant_type=refresh_token → oturum yenileme
       3) GET/POST/PATCH/DELETE /rest/v1/<tablo>       → veri

   Yayınlanan iki değer (App.DEFAULTS.sbUrl / sbKey) BİLEREK GİZLİ DEĞİLDİR:
   "publishable" anahtar yalnızca RLS ile korunan tablolara erişir; gerçek
   yetki satır düzeyinde politikalarla (RLS) verilir. service_role anahtarı
   asla istemciye konmaz.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});

  App.SB_STORAGE = 'deneyap.auth.v1';

  /* ------------------------------------------------ yardımcılar ---------- */

  function conf() {
    const s = typeof App.settings === 'function' ? App.settings() : {};
    return {
      url: (s.sbUrl || App.DEFAULTS.sbUrl || '').replace(/\/+$/, ''),
      key: s.sbKey || App.DEFAULTS.sbKey || ''
    };
  }

  function store(read) {
    try {
      if (read) return JSON.parse(localStorage.getItem(App.SB_STORAGE) || 'null');
      return true;
    } catch (e) { return null; }
  }

  function save(sess) {
    try {
      if (sess) localStorage.setItem(App.SB_STORAGE, JSON.stringify(sess));
      else localStorage.removeItem(App.SB_STORAGE);
    } catch (e) { console.warn('[sb] oturum yazılamadı', e); }
  }

  /* Supabase hatalarını Türkçe, okunabilir metne çevirir. */
  function human(err) {
    const code = err && err.code;
    const msg = (err && err.msg) || (err && err.message) || '';
    if (code === 'PGRST205' || /Could not find the table/i.test(msg))
      return 'Kurulum bekleniyor: veritabanı şeması henüz yüklenmedi.';
    if (code === 'invalid_credentials' || /Invalid login credentials/i.test(msg))
      return 'E-posta veya şifre hatalı.';
    if (code === 'user_already_exists' || /already (been )?registered/i.test(msg))
      return 'Bu e-posta zaten kayıtlı.';
    if (code === 'weak_password' || /password should be|at least 6 char/i.test(msg))
      return 'Şifre çok zayıf (en az 6 karakter).';
    if (code === 'email_not_confirmed' || /Email not confirmed/i.test(msg))
      return 'E-posta doğrulanmamış. Gelen kutunuzdaki bağlantıyı onaylayın.';
    if (code === 'signup_disabled' || /Signups not allowed/i.test(msg))
      return 'Yeni kayıt kapalı.';
    if (code === 'over_email_send_rate_limit' || /rate limit/i.test(msg))
      return 'Çok fazla deneme. Birkaç dakika sonra tekrar deneyin.';
    if (/redirect|redirect.*url/i.test(msg))
      return 'Yönlendirme adresi Supabase\'de izinli değil (Site URL ayarı).';
    if (/Failed to fetch|NetworkError|Ağ hatası/i.test(msg)) return 'İnternet bağlantısı yok.';
    return msg || 'Bilinmeyen hata (HTTP ' + (err && err.status) + ').';
  }

  /* Supabase gövdesi iki biçimde gelir:
       GoTrue  : {"code":400,"msg":"..."}  veya  {"error_code":"weak_password","msg":"..."}
       PostgREST: {"code":"PGRST205","message":"..."}      */
  function toError(body, status) {
    const msg = (body && (body.message || body.msg || body.error_description || body.error)) || '';
    const e = new Error(msg || ('HTTP ' + status));
    let code = null;
    if (body) {
      if (typeof body.error_code === 'string') code = body.error_code;
      else if (typeof body.code === 'string') code = body.code;
    }
    e.code = code || ('http_' + status);
    e.status = (body && typeof body.code === 'number') ? body.code : status;
    e.msg = msg;
    e.human = human(e);
    return e;
  }

  function baseHeaders(token) {
    const c = conf();
    const h = { apikey: c.key, 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  async function request(path, opts) {
    opts = opts || {};
    const c = conf();
    if (!c.url || !c.key) {
      const e = new Error('Supabase adresi/anahtarı ayarlanmamış.');
      e.code = 'not_configured'; e.human = e.message;
      throw e;
    }
    let res;
    try {
      res = await fetch(c.url + path, {
        method: opts.method || 'GET',
        headers: Object.assign(baseHeaders(opts.token), opts.headers || {}),
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
    } catch (e) {
      const err = new Error('Ağ hatası');
      err.code = 'network'; err.human = 'İnternet bağlantısı yok.';
      throw err;
    }
    if (res.status === 204) return null;
    let body = null;
    const text = await res.text();
    if (text) { try { body = JSON.parse(text); } catch (e) { body = { message: text }; } }
    if (!res.ok) throw toError(body, res.status);
    return body;
  }

  /* ------------------------------------------------ oturum --------------- */

  function current() {
    const s = store(true);
    if (!s || !s.access_token) return null;
    /* expires_at: saniye cinsinden Unix zaman damgası */
    if (s.expires_at && Date.now() / 1000 > s.expires_at - 60) return null;
    return s;
  }

  /* Süresi dolmuş ama yenilenebilir oturumu döndürür (giriş gerektirmez). */
  async function ensureSession() {
    const live = current();
    if (live) return live;
    const s = store(true);
    if (!s || !s.refresh_token) return null;
    try {
      const body = await request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: s.refresh_token }
      });
      return saveSession(body);
    } catch (e) {
      console.warn('[sb] oturum yenilenemedi:', e.human);
      save(null);
      return null;
    }
  }

  function saveSession(body) {
    const now = Math.floor(Date.now() / 1000);
    const sess = {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: now + (body.expires_in || 3600),
      user: body.user || null
    };
    save(sess);
    return sess;
  }

  /* ------------------------------------------- dışa açık API ------------- */

  App.SB = {
    conf: conf,
    human: human,
    hasConfig: function () { const c = conf(); return !!(c.url && c.key); },

    token: async function () {
      const s = await ensureSession();
      return s ? s.access_token : null;
    },

    signIn: async function (email, password) {
      const body = await request('/auth/v1/token?grant_type=password', {
        method: 'POST', body: { email: String(email || '').trim(), password: password }
      });
      return saveSession(body);
    },

    signUp: async function (email, password, data) {
      const body = await request('/auth/v1/signup', {
        method: 'POST',
        body: {
          email: String(email || '').trim(),
          password: password,
          data: data || {}
        }
      });
      /* E-posta onayı kapalıysa doğrudan oturum gelir; açıksa kullanıcı
         nesnesi gelir ve onay beklemedir. İkisini de aynı biçimde döndürüyoruz. */
      if (body && body.access_token) return saveSession(body);
      return { pending: true, user: body.user || body || null };
    },

    signOut: async function () {
      const s = store(true);
      save(null);
      if (s && s.access_token) {
        try { await request('/auth/v1/logout', { method: 'POST', token: s.access_token }); }
        catch (e) { /* çıkışta hata görmezden gelinir */ }
      }
      return true;
    },

    session: function () { return current(); },

    /* Auth modülü (auth.js) oturum geri yüklerken/yenilerken bunu kullanır.
       Dışa aktarılmazsa her sayfa yenilemesinde oturum düşer —
       "Cihazı Bağla" pasif kalır (canClaim, oturumsuzken false olur). */
    ensureSession: ensureSession,

    /* Şema yüklü mü? Oturum GEREKTİRMEZ — giriş yapılmadan da panel
       "kurulum bekleniyor" diyebilmeli. Tablo yoksa PGRST205 döner. */
    probeSetup: async function () {
      if (!App.SB.hasConfig()) return false;
      try {
        await request('/rest/v1/profiles?select=id&limit=1', { method: 'GET' });
        return true;
      } catch (e) {
        if (e.code === 'PGRST205') return false;
        /* RLS ya da ağ hatası: tablo var demektir. */
        return e.code !== 'network';
      }
    },

    profile: async function () {
      const sess = await ensureSession();
      if (!sess) return null;
      try {
        const rows = await App.SB.rest('profiles?id=eq.' + sess.user.id + '&select=*');
        return (rows && rows[0]) || null;
      } catch (e) {
        if (e.code === 'PGRST205') return { __setupRequired: true };
        throw e;
      }
    },

    /* ---- PostgREST sarmalayıcı: /rest/v1/<yol> ---- */
    rest: async function (path, opts) {
      opts = opts || {};
      const sess = await ensureSession();
      const token = (sess && sess.access_token) ||
                    (opts.anonymous ? null : null);
      const headers = {};
      if (opts.prefer) headers.Prefer = opts.prefer;
      if (opts.range) headers.Range = opts.range;
      return request('/rest/v1/' + path, Object.assign({}, opts, {
        token: token,
        headers: headers
      }));
    },

    /* Tablo yoksa (PGRST205) hatayı çağırana geçirir; kurulum sihirbazı
       böylece "şema eksik" durumunu ayırt edebilir. */
    isSetupMissing: function (e) { return !!(e && e.code === 'PGRST205'); }
  };
})();
