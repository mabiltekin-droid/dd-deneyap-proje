/* ==========================================================================
   blackbox.js — Olay Anı Telemetri Kara Kutusu & Olay Oynatıcı (Incident Replay)
   - 60 Saniyelik FIFO Ring Buffer (Olay Öncesi Bellek Tamponu)
   - Tehlike / Sel Anında Otomatik Olay Yakalama (60s Öncesi + 60s Sonrası)
   - IndexedDB Kalıcı Depolama ('deneyap_blackbox', store: 'incidents')
   - Zaman Çubuğu (Timeline Scrubber) & Saniye Saniye Olay Yeniden Oynatıcı
   ========================================================================== */

(function () {
  'use strict';

  window.App = window.App || {};

  const DB_NAME = 'deneyap_blackbox';
  const DB_VERSION = 1;
  const STORE_NAME = 'incidents';
  const RING_CAPACITY = 60; // 60 saniyelik tampon

  let ringBuffer = [];
  let isRecordingPost = false;
  let activeIncident = null;
  let postSamples = [];
  let postTimer = null;
  let lastSampleTs = 0;

  // Oynatıcı (Replay Player) Durumu
  let loadedIncident = null;
  let playbackTimer = null;
  let isPlaying = false;

  /* ---------------------------------------------------- IndexedDB Altyapısı */

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        return reject(new Error('IndexedDB desteklenmiyor'));
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = function (e) {
        resolve(e.target.result);
      };
      req.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  function saveIncidentToDB(record) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);
        req.onsuccess = function () { resolve(record); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    }).catch(function (err) {
      console.warn('[blackbox] DB kayıt hatası:', err);
    });
  }

  function getAllIncidentsFromDB() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    }).catch(function () {
      return [];
    });
  }

  /* ------------------------------------------------ Örnek Tatbikat Kaydı */
  function generateDemoIncident() {
    const samples = [];
    const now = Date.now();
    const triggerIdx = 30;

    for (let i = 0; i < 60; i++) {
      const relSec = i - triggerIdx;
      let ppm = 45;
      let raw = 180;
      let fan = false;
      let pump = false;
      let state = 'normal';

      if (relSec >= 0) {
        // Tehlike anı ve sonrası
        ppm = Math.min(850, 420 + relSec * 16);
        raw = Math.min(920, 520 + relSec * 14);
        state = 'danger';
        if (relSec >= 2) fan = true; // 2 saniye sonra otomatik fan
      } else if (relSec >= -8) {
        // Sızıntı başlangıç rampası
        ppm = 120 + (8 + relSec) * 35;
        raw = 250 + (8 + relSec) * 32;
        state = 'warning';
      }

      samples.push({
        time: now + relSec * 1000,
        ppm: Math.round(ppm),
        raw: Math.round(raw),
        rain: false,
        fan: fan,
        pump: pump,
        state: state
      });
    }

    return {
      id: 'demo_tatbikat_1',
      title: 'Tatbikat Kaydı — Gaz Sızıntısı & Otonom Fan Tahliyesi',
      timestamp: now,
      type: 'Gaz Tehlikesi',
      triggerIndex: triggerIdx,
      samples: samples
    };
  }

  /* ---------------------------------------------------- Ring Buffer İşlemleri */

  function formatRelativeTime(sec) {
    const sign = sec >= 0 ? '+' : '-';
    const abs = Math.abs(sec);
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    const pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return sign + pad(m) + ':' + pad(s) + (sec === 0 ? ' [OLAY]' : '');
  }

  function ingest(data) {
    if (!data) return;
    const now = Date.now();

    // Saniyede 1 kereden fazla örnek alma (1Hz örnekleme)
    if (now - lastSampleTs < 950) return;
    lastSampleTs = now;

    const ppm = Number(data.gasPpm) || 0;
    const raw = Number(data.gasRaw) || 0;
    const rain = !!data.rain;
    const fan = !!data.fan;
    const pump = !!data.pump;
    const state = data.state || (ppm >= 400 ? 'danger' : (ppm >= 250 ? 'warning' : 'normal'));

    const sample = {
      time: now,
      ppm: ppm,
      raw: raw,
      rain: rain,
      fan: fan,
      pump: pump,
      state: state
    };

    // 1. Olay Sonrası Kayıt Modu Açık Değilse Ring Buffer'a Ekle
    if (!isRecordingPost) {
      ringBuffer.push(sample);
      if (ringBuffer.length > RING_CAPACITY) {
        ringBuffer.shift();
      }

      // 2. Olay Tetikleme Koşulu (Gaz Tehlikesi veya Sel)
      const isIncident = (state === 'danger' || (rain && data.auto));
      if (isIncident) {
        triggerIncidentCapture(sample);
      }
    } else {
      // Olay sonrası 60 saniyelik veri toplanıyor
      postSamples.push(sample);
      if (postSamples.length >= RING_CAPACITY) {
        finalizeIncident();
      }
    }
  }

  function triggerIncidentCapture(initialSample) {
    isRecordingPost = true;
    postSamples = [initialSample];

    activeIncident = {
      id: 'inc_' + Date.now(),
      title: 'Tehlike Kaydı #' + (Date.now().toString().slice(-4)) + ' — ' + new Date().toLocaleTimeString('tr-TR'),
      timestamp: Date.now(),
      type: initialSample.state === 'danger' ? 'Gaz Tehlikesi' : 'Su Baskını Alarmı',
      preSamples: ringBuffer.slice(),
      triggerIndex: ringBuffer.length - 1
    };

    if (window.App && window.App.toast) {
      window.App.toast('Kara Kutu: Olay kaydı başlatıldı (60s öncesi tamponlandı)', { kind: 'warn' });
    }

    // Güvenlik zaman aşımı: 65 saniye sonra zorla tamamla
    clearTimeout(postTimer);
    postTimer = setTimeout(finalizeIncident, 65000);
  }

  function finalizeIncident() {
    clearTimeout(postTimer);
    if (!activeIncident) {
      isRecordingPost = false;
      return;
    }

    const fullSamples = (activeIncident.preSamples || []).concat(postSamples);
    const incidentRecord = {
      id: activeIncident.id,
      title: activeIncident.title,
      timestamp: activeIncident.timestamp,
      type: activeIncident.type,
      triggerIndex: activeIncident.triggerIndex,
      samples: fullSamples
    };

    saveIncidentToDB(incidentRecord).then(function () {
      if (window.App && window.App.toast) {
        window.App.toast('Kara Kutu: Olay başarıyla IndexedDB hafızasına yazıldı', { kind: 'ok' });
      }
      refreshIncidentDropdown();
      loadIncident(incidentRecord);
    });

    activeIncident = null;
    postSamples = [];
    isRecordingPost = false;
  }

  /* ---------------------------------------------------- Replay Scrubber UI */

  function updateScrubberUI(idx) {
    if (!loadedIncident || !loadedIncident.samples || !loadedIncident.samples.length) return;
    const samples = loadedIncident.samples;
    const curIdx = Math.max(0, Math.min(samples.length - 1, idx));
    const sample = samples[curIdx];

    const scrubber = document.getElementById('bbScrubber');
    if (scrubber) scrubber.value = curIdx;

    const relSec = curIdx - (loadedIncident.triggerIndex || 0);
    const timeLabel = document.getElementById('bbTimeLabel');
    if (timeLabel) timeLabel.textContent = formatRelativeTime(relSec);

    const setText = function (id, txt) {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    setText('bbValTime', new Date(sample.time).toLocaleTimeString('tr-TR'));
    setText('bbValPpm', sample.ppm + ' PPM');
    setText('bbValRaw', 'ADC: ' + sample.raw);
    setText('bbValRain', sample.rain ? 'ISLAK (Alarm)' : 'KURU');
    setText('bbValFan', sample.fan ? 'AÇIK (Tahliye)' : 'KAPALI');
    setText('bbValPump', sample.pump ? 'AÇIK' : 'KAPALI');

    const body = document.getElementById('blackboxBody');
    if (body) {
      body.setAttribute('data-state', sample.state || 'normal');
    }
  }

  function loadIncident(record) {
    if (!record || !record.samples || !record.samples.length) return;
    loadedIncident = record;
    stopPlayback();

    const scrubber = document.getElementById('bbScrubber');
    if (scrubber) {
      scrubber.min = 0;
      scrubber.max = record.samples.length - 1;
      scrubber.value = record.triggerIndex || 0;
    }

    updateScrubberUI(record.triggerIndex || 0);
  }

  function startPlayback() {
    if (!loadedIncident || !loadedIncident.samples) return;
    stopPlayback();
    isPlaying = true;

    const playBtn = document.getElementById('bbPlayBtn');
    if (playBtn) playBtn.textContent = '⏸';

    const scrubber = document.getElementById('bbScrubber');
    let cur = Number(scrubber ? scrubber.value : 0);

    playbackTimer = setInterval(function () {
      cur++;
      if (cur >= loadedIncident.samples.length) {
        cur = 0; // Başa sar
      }
      updateScrubberUI(cur);
    }, 450);
  }

  function stopPlayback() {
    isPlaying = false;
    if (playbackTimer) {
      clearInterval(playbackTimer);
      playbackTimer = null;
    }
    const playBtn = document.getElementById('bbPlayBtn');
    if (playBtn) playBtn.textContent = '▶';
  }

  function togglePlayback() {
    if (isPlaying) stopPlayback();
    else startPlayback();
  }

  function refreshIncidentDropdown() {
    const select = document.getElementById('blackboxSelect');
    if (!select) return;

    getAllIncidentsFromDB().then(function (list) {
      select.innerHTML = '';

      if (!list.length) {
        // İlk kullanımda örnek tatbikat kaydı oluştur
        const demo = generateDemoIncident();
        list.push(demo);
        saveIncidentToDB(demo);
      }

      list.forEach(function (inc, idx) {
        const opt = document.createElement('option');
        opt.value = inc.id;
        opt.textContent = inc.title;
        select.appendChild(opt);
      });

      if (!loadedIncident && list.length) {
        loadIncident(list[0]);
      }
    });
  }

  function setupDOM() {
    const select = document.getElementById('blackboxSelect');
    if (select) {
      select.addEventListener('change', function () {
        const id = select.value;
        getAllIncidentsFromDB().then(function (list) {
          const found = list.find(function (item) { return item.id === id; });
          if (found) loadIncident(found);
        });
      });
    }

    const scrubber = document.getElementById('bbScrubber');
    if (scrubber) {
      scrubber.addEventListener('input', function () {
        stopPlayback();
        updateScrubberUI(Number(scrubber.value));
      });
    }

    const playBtn = document.getElementById('bbPlayBtn');
    if (playBtn) {
      playBtn.addEventListener('click', togglePlayback);
    }

    refreshIncidentDropdown();
  }

  function init() {
    setupDOM();
  }

  function destroy() {
    stopPlayback();
    clearTimeout(postTimer);
    postTimer = null;
    isRecordingPost = false;
    activeIncident = null;
    ringBuffer = [];
  }

  window.App.Blackbox = {
    init: init,
    destroy: destroy,
    ingest: ingest,
    loadIncident: loadIncident,
    refreshDropdown: refreshIncidentDropdown
  };
})();
