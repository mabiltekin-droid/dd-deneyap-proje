/* ==========================================================================
   devices.js — Çoklu cihaz yöneticisi (veri katmanı + panel mantığı)
   --------------------------------------------------------------------------
   Panel aynı anda TEK bir cihazla konuşur (taşıma tek MQTT konusuna bağlanır).
   Bu modül "hangi cihaz aktif" sorusunu ve cihaz başına MQTT konusu eşlemesini
   yönetir:

     • App.settings().activeDeviceId  → seçili cihaz (boş = otomatik)
     • App.settings().deviceTopics    → cihaz kimliği -> MQTT konusu

   Konu bilgisi hem yerelde (deviceTopics) hem bağlama kaydında (binding.topic,
   bağlanma anında yazılır) tutulur. Bir cihaz ilk kez görüldüğünde konusu
   otomatik öğrenilir (bkz. app.js → learn()).

   DOM işleri settings.js'tedir; burada yalnızca mantık vardır.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});

  function settings() {
    return (App.settings ? App.settings() : {}) || {};
  }

  /* Panelin şu an konuştuğu cihaz kimliği ('' = henüz bilinmiyor). */
  function currentId() {
    return settings().activeDeviceId || '';
  }

  function topicMap() {
    return Object.assign({}, settings().deviceTopics || {});
  }

  /* Bir cihazın MQTT konusu: yerel harita → bağlama kaydı → mevcut konu. */
  function topicFor(deviceId) {
    if (!deviceId) return settings().mqttTopic || '';
    const map = topicMap();
    if (map[deviceId]) return map[deviceId];
    const b = App.Auth && App.Auth.bindingOf ? App.Auth.bindingOf(deviceId) : null;
    if (b && b.topic) return b.topic;
    return settings().mqttTopic || '';
  }

  /* Cihaz başına konuyu kaydet. */
  function setTopic(deviceId, topic) {
    if (!deviceId) return false;
    const map = topicMap();
    topic = String(topic || '').trim();
    if (!topic) delete map[deviceId];
    else map[deviceId] = topic;
    App.saveSettings({ deviceTopics: map });
    return true;
  }

  /* Yeni görülen cihazı öğren: konusunu yaz, aktif cihaz yoksa onu seç.
     Her durum karesinde çağrılır → yalnızca değişiklikte yazar. */
  function learn(deviceId, topic) {
    if (!deviceId) return false;
    const s = settings();
    const map = topicMap();
    const patch = {};
    let changed = false;

    if (topic && map[deviceId] !== topic) {
      map[deviceId] = topic;
      patch.deviceTopics = map;
      changed = true;
    }
    if (!s.activeDeviceId) {
      patch.activeDeviceId = deviceId;
      changed = true;
    }
    if (changed) App.saveSettings(patch);
    return changed;
  }

  /* Aktif cihazı değiştir: konusunu uygula ve taşımayı yeniden başlat.
     Taşıma yeni konuya bağlanınca cihaz kimliği status'ten doğrulanır. */
  function activate(deviceId) {
    if (!deviceId) return '';
    const topic = topicFor(deviceId);
    const patch = { activeDeviceId: deviceId };
    if (topic) patch.mqttTopic = topic;
    App.saveSettings(patch);
    restartTransport();
    return topic;
  }

  function restartTransport() {
    try {
      if (App.mqtt && App.mqtt.restart) { App.mqtt.restart(); return; }
    } catch (e) { /* yoksay */ }
    try {
      if (App.api && App.api.startMqtt) App.api.startMqtt();
    } catch (e) { /* yoksay */ }
  }

  /* Kullanıcının cihazları: sunucudaki bağlantılar (kendi adına) +
     yerelde bilinen ama henüz bağlanmamış kimlikler. */
  async function list() {
    let rows = [];
    try {
      rows = await App.Auth.listBindings();
    } catch (e) { rows = []; }

    const snap = (App.Auth && App.Auth.snapshot) ? App.Auth.snapshot() : null;
    const uid = snap && snap.user && snap.user.id;
    const active = currentId();

    const out = [];
    (rows || []).forEach(function (r) {
      if (!r || !r.device_id) return;
      if (uid && r.owner_id && r.owner_id !== uid) return;   /* admin: başkalarınınkini listeleme */
      out.push({
        id: r.device_id,
        label: r.label || '',
        status: r.status || 'active',
        topic: topicFor(r.device_id),
        bound: true,
        active: (active === r.device_id)
      });
    });

    /* Yerel haritada olup bağlı görünmeyenler (henüz bağlanmamış kart). */
    const map = topicMap();
    Object.keys(map).forEach(function (id) {
      for (let i = 0; i < out.length; i++) { if (out[i].id === id) return; }
      out.push({
        id: id,
        label: '',
        status: 'unbound',
        topic: map[id],
        bound: false,
        active: (active === id)
      });
    });

    return out;
  }

  /* Aktif cihaz özeti. */
  function activeInfo() {
    const id = currentId();
    return { id: id, topic: id ? topicFor(id) : (settings().mqttTopic || '') };
  }

  /* Aktif seçimi bırak (otomatik öğrenmeye döner). */
  function clearActive() {
    App.saveSettings({ activeDeviceId: '' });
    return true;
  }

  App.Devices = {
    currentId: currentId,
    activeInfo: activeInfo,
    topics: topicMap,
    topicFor: topicFor,
    setTopic: setTopic,
    learn: learn,
    activate: activate,
    clearActive: clearActive,
    list: list
  };
})();
