/* ==========================================================================
   voice.js — Sesli Komut Kumandası (Web Speech API)
   --------------------------------------------------------------------------
   • Türkçe (tr-TR) konuşma tanıma ile panele komut verir:
       "pencereyi kapat", "panjuru aç", "fanı çalıştır", "pompayı durdur",
       "sireni çal", "alarmı sustur", "otomasyonu kapat", "gece moduna geç",
       "durum nedir", "alarmı simüle et", "gazı kalibre et".
   • Tarayıcı desteklemiyorsa mikrofon düğmesi gizlenir (progressive).
   • Cihaz başka bir hesaba bağlıysa (görünmez) komut reddedilir.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const $ = function (id) { return document.getElementById(id); };

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recog = null;
  let listening = false;
  let bound = false;

  /* ------------------------------------------------------------ yardımcılar */

  function norm(s) {
    return String(s || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/[.,!?;:"'()\[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function has(text, words) {
    for (let i = 0; i < words.length; i++) {
      if (text.indexOf(words[i]) !== -1) return true;
    }
    return false;
  }

  const OPEN = ['ac', 'aç', 'acar', 'açar', 'açı', 'acik', 'açık', 'calistir', 'çalıştır', 'baslat', 'başlat', 'yukari', 'yükselt', 'kaldir', 'kaldır'];
  const CLOSE = ['kapat', 'kapa', 'kapatir', 'kapatır', 'sustur', 'sus', 'durdur', 'kes', 'indir', 'off', 'kapatıver'];
  const STOP = ['serbest', 'birak', 'bırak', 'bekle', 'dur'];
  const AJAR = ['aralik', 'aralık', 'yari', 'yarı', 'yarım', 'az'];
  const CLEAR = ['temizle', 'sifirla', 'sıfırla', 'iptal', 'sondur'];
  const TEST = ['test', 'simule', 'simüle', 'deneme', 'tatbikat'];

  function speakFeedback(msg) {
    if (!msg) return;
    if (App.Automation && !App.Automation.ttsAllowed()) return;
    if (App.voice && App.voice.speak) App.voice.speak(msg);
  }

  function deviceAllowed() {
    /* Görünmez (başka hesaba bağlı) cihazı sesle de yönetemeyiz. */
    let t = null;
    try { t = App.lastTelemetry ? App.lastTelemetry() : null; } catch (e) { t = null; }
    if (t && t.dev && App.Auth && App.Auth.canControl) return App.Auth.canControl(t.dev);
    return true;
  }

  function refuse() {
    if (App.toast) App.toast('Bu cihaz başka bir hesaba bağlı — komut reddedildi.', { kind: 'warn' });
    speakFeedback('Bu cihazı yönetme yetkiniz yok.');
  }

  function run(device, action, value, okMsg) {
    if (!deviceAllowed()) { refuse(); return Promise.resolve(false); }
    let p;
    try {
      p = Promise.resolve(App.api.control(device, action, value));
    } catch (e) {
      p = Promise.reject(e);
    }
    return p.then(function () {
      if (App.toast) App.toast(okMsg || 'Komut gönderildi', { kind: 'ok' });
      if (App.sound && App.sound.click) App.sound.click();
      speakFeedback(okMsg);
      return true;
    }).catch(function () {
      if (App.toast) App.toast('Komut iletilemedi — bağlantıyı kontrol edin.', { kind: 'danger' });
      return false;
    });
  }

  /* ------------------------------------------------------------- durum raporu */

  function reportStatus() {
    if (!deviceAllowed()) { refuse(); return; }
    Promise.resolve(App.api.status()).then(function (d) {
      if (!d) throw new Error('no data');
      const ppm = Number(d.gasPpm) || 0;
      const s = App.settings ? App.settings() : {};
      const dangerTh = (typeof d.gasDanger === 'number') ? d.gasDanger : (s.gasDanger || 400);
      const warnTh = (typeof d.gasWarn === 'number') ? d.gasWarn : (s.gasWarn || 250);
      const state = d.flame ? 'Alev alarmı' : d.vib ? 'Sarsıntı alarmı' :
        d.flood ? 'Su baskını' :
        (ppm >= dangerTh ? 'Gaz tehlikesi' : (ppm >= warnTh ? 'Gaz uyarısı' : 'Güvende'));
      const mode = App.Automation ? App.Automation.current() : 'home';
      const msg = 'Sistem durumu: ' + state + '. Gaz ' + ppm + ' ppm. ' +
        'Pencere ' + (Number(d.window) > 30 ? 'açık' : 'kapalı') + '. ' +
        'Çalışma modu ' + (App.Automation ? App.Automation.profile(mode).label : mode) + '.';
      if (App.toast) App.toast(msg, { kind: 'ok', duration: 7000 });
      speakFeedback(msg);
    }).catch(function () {
      if (App.toast) App.toast('Durum alınamadı — cihaz çevrimdışı olabilir.', { kind: 'warn' });
    });
  }

  /* ---------------------------------------------------------------- yorumlayıcı */

  function detectMode(t) {
    let m = null;
    if (has(t, ['gece'])) m = 'night';
    else if (has(t, ['tatil', 'seyahat', 'yokluk', 'tatile'])) m = 'away';
    else if (has(t, ['evde', 'normal mod'])) m = 'home';
    else if (has(t, ['izleme', 'monitor', 'monitör'])) m = 'off';
    if (!m) return null;
    /* "kapalı" yalnız mod bağlamında izleme modu sayılır */
    if (has(t, ['kapali', 'kapalı']) && has(t, ['mod'])) m = 'off';
    if (has(t, ['mod']) || m) return m;
    return null;
  }

  function handle(raw) {
    const t = norm(raw);
    if (!t) return 'empty';

    /* 1) Test / simülasyon */
    if (has(t, TEST) && has(t, ['alarm', 'yangin', 'yangın', 'gaz', 'siren'])) {
      run('test', 'simulate_alarm', 0, 'Alarm simülasyonu başlatıldı.');
      return 'simulate';
    }

    /* 2) Gaz kalibrasyonu */
    if (has(t, ['kalibre', 'kalibrasyon', 'taban'])) {
      run('gas', 'recalibrate', 0, 'Gaz sensörü tabanı yeniden ölçülüyor.');
      return 'calibrate';
    }

    /* 3) Durum raporu */
    if (has(t, ['durum', 'rapor', 'ozet', 'özet', 'nasil', 'nasıl', 'nedir'])) {
      reportStatus();
      return 'status';
    }

    /* 4) Mod değişimi */
    const mode = detectMode(t);
    if (mode && (has(t, ['mod']) || !has(t, ['pencere', 'panjur', 'perde', 'fan', 'pompa', 'motor', 'siren', 'ses']))) {
      if (App.Automation) {
        App.Automation.apply(mode, { source: 'voice', push: true });
        return 'mode:' + mode;
      }
    }

    const close = has(t, CLOSE);
    const stop = has(t, STOP);
    const open = has(t, OPEN);

    /* 5) Pencere */
    if (has(t, ['pencere', 'davlumbaz'])) {
      if (stop) return run('window', 'stop', 0, 'Pencere serbest bırakıldı.'), 'window:stop';
      if (close) return run('window', 'shut', 0, 'Pencere kapatıldı.'), 'window:shut';
      if (has(t, AJAR)) return run('window', 'ajar', 0, 'Pencere aralık konuma getirildi.'), 'window:ajar';
      if (open) return run('window', 'open', 0, 'Pencere tam açıldı.'), 'window:open';
    }

    /* 6) Panjur / perde */
    if (has(t, ['panjur', 'perde', 'panjuru'])) {
      if (stop) return run('blind', 'stop', 0, 'Panjur serbest bırakıldı.'), 'blind:stop';
      if (close) return run('blind', 'shut', 0, 'Panjur kapatıldı.'), 'blind:shut';
      if (open) return run('blind', 'open', 0, 'Panjur açıldı.'), 'blind:open';
    }

    /* 7) Siren / ses */
    if (has(t, ['siren', 'alarm', 'hoparlor', 'hoparlör'])) {
      if (close) return run('sound', 'off', 0, 'Siren susturuldu.'), 'sound:off';
      if (has(t, TEST)) return run('sound', 'test', 0, 'Test tonu çalınıyor.'), 'sound:test';
      if (open || has(t, ['cal', 'çal'])) return run('sound', 'siren', 0, 'Siren çalınıyor.'), 'sound:siren';
    }

    /* 8) Fan */
    if (has(t, ['fan', 'vantilator', 'vantilatör', 'havalandir', 'havalandır'])) {
      if (close) return run('fan', 'off', 0, 'Fan durduruldu.'), 'fan:off';
      if (open) return run('fan', 'on', 0, 'Fan çalıştırıldı.'), 'fan:on';
    }

    /* 9) Su motoru / pompa */
    if (has(t, ['pompa', 'motor'])) {
      if (close) return run('pump', 'off', 0, 'Su motoru durduruldu.'), 'pump:off';
      if (open) return run('pump', 'on', 0, 'Su motoru çalıştırıldı.'), 'pump:on';
    }

    /* 10) Otonom koruma */
    if (has(t, ['otomasyon', 'otomatik', 'koruma'])) {
      if (close) return run('auto', 'off', 0, 'Otonom koruma kapatıldı.'), 'auto:off';
      if (open) return run('auto', 'on', 0, 'Otonom koruma açıldı.'), 'auto:on';
      return run('auto', 'toggle', 0, 'Otonom koruma değiştirildi.'), 'auto:toggle';
    }

    /* 11) Sarsıntı sensörü */
    if (has(t, ['titresim', 'titreşim', 'sarsinti', 'sarsıntı'])) {
      if (has(t, CLEAR)) return run('vibration', 'clear', 0, 'Sarsıntı durumu temizlendi.'), 'vib:clear';
      if (has(t, TEST)) return run('vibration', 'test', 0, 'Sarsıntı testi tetiklendi.'), 'vib:test';
    }

    /* 12) Alev sensörü */
    if (has(t, ['alev', 'yangin', 'yangın'])) {
      if (has(t, CLEAR)) return run('flame', 'clear', 0, 'Alev durumu temizlendi.'), 'flame:clear';
      if (has(t, TEST)) return run('flame', 'test', 0, 'Alev testi tetiklendi.'), 'flame:test';
    }

    if (App.toast) App.toast('Komut anlaşılamadı: “' + raw + '”', { kind: 'warn' });
    return 'unknown';
  }

  /* ------------------------------------------------------------------ mikrofon */

  function setListening(on, note) {
    listening = on;
    const btn = $('voiceBtn');
    if (btn) {
      btn.classList.toggle('listening', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    hint(note || (on ? 'Dinliyorum… konuşun' : ''));
  }

  function hint(msg) {
    const el = $('voiceHint');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('show', !!msg);
    if (msg) {
      clearTimeout(hint._t);
      hint._t = setTimeout(function () { el.classList.remove('show'); }, 5000);
    }
  }

  function start() {
    if (!recog || listening) return;
    try { recog.start(); }
    catch (e) { /* InvalidStateError — zaten çalışıyor */ }
  }

  function stop() {
    if (!recog) return;
    try { recog.stop(); } catch (e) { /* yoksay */ }
  }

  function initRecognition() {
    recog = new SR();
    recog.lang = 'tr-TR';
    recog.continuous = false;
    recog.interimResults = true;
    recog.maxAlternatives = 1;

    recog.onstart = function () { setListening(true, 'Dinliyorum… konuşun'); };

    recog.onresult = function (ev) {
      let interim = '', finalTxt = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalTxt += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) hint('“' + interim.trim() + '…');
      if (finalTxt) {
        const text = finalTxt.trim();
        hint('“' + text + '”');
        handle(text);
      }
    };

    recog.onerror = function (ev) {
      const code = ev && ev.error;
      const msg = code === 'not-allowed' || code === 'service-not-allowed'
        ? 'Mikrofon izni reddedildi.'
        : code === 'no-speech' ? 'Ses algılanamadı, tekrar deneyin.'
        : code === 'audio-capture' ? 'Mikrofon bulunamadı.'
        : 'Ses tanıma hatası (' + code + ').';
      hint(msg);
      if (App.toast) App.toast(msg, { kind: 'warn' });
    };

    recog.onend = function () { setListening(false); };
  }

  function bind() {
    if (bound) return;
    bound = true;
    const btn = $('voiceBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (listening) { stop(); setListening(false, ''); }
      else start();
    });
  }

  function init() {
    const btn = $('voiceBtn');
    if (!btn) return;
    if (!SR) { btn.hidden = true; btn.setAttribute('aria-hidden', 'true'); return; }
    try { initRecognition(); } catch (e) { btn.hidden = true; return; }
    bind();
  }

  App.Speech = {
    init: init,
    handle: handle,
    start: start,
    stop: stop,
    available: function () { return !!SR; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
