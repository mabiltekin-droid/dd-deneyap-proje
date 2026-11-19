/* ==========================================================================
   voice.js — Sıfır-API Türkçe Sesli Komut ve Navigasyon Motoru (Web Speech API)
   --------------------------------------------------------------------------
   • Tamamen yerel (harici NLP/AI API'si kullanmaz) Türkçe morfoloji (ek
     sıyırma, ünsüz yumuşaması çözümü), Damerau-Levenshtein bulanık eşleştirme
     ve çoklu STT adayı sıralama motoru içerir.
   • Tüm sekmeler, sayfalar, ayar bölümleri, sensör kartları ve 3D ev
     odalarına doğrudan veya Türkçe yönlendirme kalıplarıyla ("Sensörleri aç",
     "Panel", "Panele gir", "Mutfağa odaklan", "Ayarlara git" vb.) geçer.
   • Mevcut tüm donanım, çalışma modu, durum raporu, tema ve kalibrasyon
     komutlarını korur ve sayısal açı/ses seviyesi algılama ile geliştirir.
   ========================================================================== */

(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const $ = function (id) { return document.getElementById(id); };

  const SR = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;
  const SGL = typeof window !== 'undefined'
    ? (window.SpeechGrammarList || window.webkitSpeechGrammarList)
    : null;

  let recog = null;
  let listening = false;
  let cancelledByUser = false;
  let bannerTimer = null;
  let bound = false;

  /* ------------------------------------------------ Türkçe metin normalizasyonu */

  function toLowerTr(s) {
    return String(s || '')
      .replace(/İ/g, 'i')
      .replace(/I/g, 'ı')
      .toLowerCase();
  }

  function foldTr(s) {
    return toLowerTr(s)
      .replace(/ç/g, 'c')
      .replace(/ğ/g, 'g')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ş/g, 's')
      .replace(/ü/g, 'u')
      .replace(/[âä]/g, 'a')
      .replace(/[îï]/g, 'i')
      .replace(/[ûù]/g, 'u');
  }

  function normalizeTokens(raw) {
    const cleaned = foldTr(raw)
      /* %50 -> yuzde 50 (yüzde hesabı doğru çalışsın), 45° -> 45 derece/sayı */
      .replace(/%/g, ' yuzde ')
      .replace(/°/g, ' ')
      /* Kelime içi kesme işaretlerini birleştir (Panel'i -> paneli, Ayarlar'a -> ayarlara) */
      .replace(/([a-z0-9])['’`´]([a-z0-9]+)/g, '$1$2')
      .replace(/[.,!?;:"'’`´()\[\]{}<>/\\|+*@#&~_=–—-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return [];
    return cleaned.split(' ').filter(Boolean);
  }

  /* ------------------------------------------- Türkçe ek sıyırma ve yumuşama */

  const TR_SUFFIXES = [
    'larimizdan', 'lerimizden', 'larimiza', 'lerimize', 'larimizi', 'lerimiz',
    'larindan', 'lerinden', 'larinda', 'lerinde', 'larina', 'lerine',
    'larini', 'lerini', 'larima', 'lerime', 'larimi', 'lerimi',
    'larim', 'lerim', 'larin', 'lerin', 'lardan', 'lerden',
    'larda', 'lerde', 'lara', 'lere', 'lari', 'leri',
    'imizdan', 'imizden', 'umuzdan', 'umuzden',
    'imiza', 'imize', 'umuza', 'umuze',
    'imizi', 'umuzu', 'imiz', 'umuz',
    'sinin', 'sunun', 'sinda', 'sinde', 'sunda', 'sunde',
    'sindan', 'sinden', 'sundan', 'sunden',
    'sina', 'sine', 'suna', 'sune', 'sini', 'sunu',
    'indan', 'inden', 'undan', 'unden',
    'inda', 'inde', 'unda', 'unde',
    'inin', 'unun', 'ina', 'ine', 'una', 'une', 'ini', 'unu',
    'imi', 'umu', 'ima', 'uma',
    'yla', 'yle', 'yia', 'yie', 'yi', 'yu', 'ya', 'ye',
    'dan', 'den', 'tan', 'ten', 'nin', 'nun',
    'nda', 'nde', 'na', 'ne', 'ni', 'nu',
    'lar', 'ler', 'lik', 'luk',
    'da', 'de', 'ta', 'te', 'si', 'su', 'im', 'um', 'in', 'un',
    'i', 'u', 'a', 'e'
  ];

  const SPECIAL_STEMS = {
    kayd: 'kayit',
    kaydi: 'kayit',
    kayda: 'kayit',
    kism: 'kisim',
    kismi: 'kisim',
    kisma: 'kisim',
    akli: 'akil',
    sehr: 'sehir'
  };

  function softenReverse(stem) {
    const out = [stem];
    if (SPECIAL_STEMS[stem]) out.push(SPECIAL_STEMS[stem]);
    if (stem.length >= 4) {
      const last = stem.charAt(stem.length - 1);
      const body = stem.slice(0, -1);
      if (last === 'g') out.push(body + 'k');       /* mutfag -> mutfak, saglig -> saglik */
      else if (last === 'b') out.push(body + 'p');  /* hesab -> hesap */
      else if (last === 'c') out.push(body + 'c');  /* no-op placeholder */
      else if (last === 'd') {
        out.push(body + 't');                       /* kilid -> kilit */
        if (SPECIAL_STEMS[stem]) out.push(SPECIAL_STEMS[stem]);
      }
    }
    return out;
  }

  function stemCandidates(word) {
    const set = new Set();
    if (!word) return set;
    set.add(word);
    softenReverse(word).forEach(function (s) { set.add(s); });
    for (let i = 0; i < TR_SUFFIXES.length; i++) {
      const suf = TR_SUFFIXES[i];
      if (word.length - suf.length >= 3 && word.slice(-suf.length) === suf) {
        const cut = word.slice(0, word.length - suf.length);
        softenReverse(cut).forEach(function (s) {
          if (s.length >= 3) set.add(s);
        });
      }
    }
    return set;
  }

  /* ----------------------------------- Sınırlı Damerau-Levenshtein mesafesi */

  function damerauDist(a, b, maxDist) {
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > maxDist) return maxDist + 1;
    if (a === b) return 0;

    const d = [];
    for (let i = 0; i <= la; i++) {
      d[i] = new Array(lb + 1);
      d[i][0] = i;
    }
    for (let j = 0; j <= lb; j++) d[0][j] = j;

    for (let i = 1; i <= la; i++) {
      let rowMin = maxDist + 1;
      for (let j = 1; j <= lb; j++) {
        const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        let v = Math.min(
          d[i - 1][j] + 1,
          d[i][j - 1] + 1,
          d[i - 1][j - 1] + cost
        );
        if (i > 1 && j > 1 &&
            a.charAt(i - 1) === b.charAt(j - 2) &&
            a.charAt(i - 2) === b.charAt(j - 1)) {
          v = Math.min(v, d[i - 2][j - 2] + 1);
        }
        d[i][j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > maxDist) return maxDist + 1;
    }
    return d[la][lb];
  }

  function fuzzyTokenMatch(tok, candidate) {
    if (tok === candidate) return 0;
    /* Çok kısa kelimelerde yanlış eşleşmeyi önlemek için yalnız tam eşleşme */
    if (tok.length <= 3 || candidate.length <= 3) return -1;
    if (Math.min(tok.length, candidate.length) === 4) {
      if (tok.charAt(0) !== candidate.charAt(0)) return -1;
      return damerauDist(tok, candidate, 1) <= 1 ? 1 : -1;
    }
    const maxDist = Math.min(tok.length, candidate.length) >= 7 ? 2 : 1;
    const dist = damerauDist(tok, candidate, maxDist);
    return dist <= maxDist ? dist : -1;
  }

  /* --------------------------------------------------- Sözlük ve bağlam seti */

  const NAV_VERB_WORDS = new Set([
    'ac', 'acar', 'acarmisin', 'acarmisiniz', 'acsana', 'aciver', 'acalim', 'acabilir', 'acabilirmisin', 'acilsin', 'acin', 'aciniz', 'acmak', 'acma',
    'gir', 'girer', 'girermisin', 'girsene', 'giriver', 'girelim', 'girebilir', 'girebilirmisin', 'girilsin', 'girin', 'giriniz', 'giris', 'girmek', 'girme',
    'git', 'gider', 'gidermisin', 'gitsene', 'gidiver', 'gidelim', 'gidebilir', 'gidebilirmisin', 'gidin', 'gidiniz', 'gitmek',
    'gec', 'gecer', 'gecermisin', 'gecsene', 'geciver', 'gecelim', 'gecebilir', 'gecebilirmisin', 'gecin', 'geciniz', 'gecis', 'gecmek',
    'goster', 'gosterir', 'gosterirmisin', 'gostersene', 'gosteriver', 'gosterelim', 'gosterebilir', 'gosterebilirmisin', 'gosterin', 'gosteriniz', 'gostermek',
    'bak', 'bakar', 'bakarmisin', 'baksana', 'bakiver', 'bakalim', 'bakabilir', 'bakin', 'bakiniz', 'bakmak',
    'goz', 'at', 'incele', 'inceler', 'inceleyelim', 'inceleyin', 'inceleyiniz', 'incelemek',
    'goruntule', 'goruntuler', 'goruntuleyelim', 'goruntuleyin', 'goruntulemek',
    'izle', 'izler', 'izleyelim', 'izleyin', 'izlemek',
    'odaklan', 'odakla', 'odaklanalim', 'odaklanin', 'yonlendir', 'yonlen', 'yonlendirir',
    'gotur', 'goturur', 'gotururmusun', 'gotursene', 'goturelim', 'goturun',
    'yaklas', 'yakinlas', 'yakinlastir', 'yaklasalim', 'zoom', 'zoomla',
    'cevir', 'dondur', 'sec', 'secelim', 'secin', 'tikla', 'bas',
    'don', 'donelim', 'donun', 'gel', 'gelelim', 'in', 'inelim', 'cik', 'cikalim',
    'getir', 'getirir', 'getirsene', 'getirelim', 'getirin',
    'cikar', 'cikart', 'listele', 'listeleyelim', 'oku', 'okuyalim',
    'gor', 'gorelim', 'gorun', 'kaydir', 'kaydiralim', 'aktar', 'ulas', 'ulasalim',
    'tasi', 'aciverin', 'gosteriverin', 'geciver'
  ]);

  const NAV_VERB_BASES = [
    'ac', 'gir', 'git', 'gec', 'goster', 'bak', 'incele', 'goruntule',
    'izle', 'odaklan', 'odakla', 'yonlendir', 'gotur', 'yaklas', 'yakinlas',
    'yakinlastir', 'getir', 'listele', 'kaydir', 'aktar', 'cevir', 'dondur'
  ];

  const NAV_POLITE_SUFFIXES = [
    'bilirmisiniz', 'bilirmisin', 'bilirmisiniz', 'ebilirmiyim', 'abilirmiyim',
    'misiniz', 'musunuz', 'misin', 'musun', 'miyim', 'muyum',
    'iverin', 'iver', 'ivar', 'sana', 'sene', 'elim', 'alim',
    'iniz', 'unuz', 'yin', 'yun', 'in', 'un', 'sin', 'sun',
    'ir', 'ar', 'er', 'ur'
  ];

  function isNavVerb(tok) {
    if (!tok) return false;
    if (NAV_VERB_WORDS.has(tok)) return true;
    for (let i = 0; i < NAV_VERB_BASES.length; i++) {
      const base = NAV_VERB_BASES[i];
      if (tok === base) return true;
      if (tok.indexOf(base) === 0 && tok.length > base.length) {
        const rest = tok.slice(base.length);
        for (let j = 0; j < NAV_POLITE_SUFFIXES.length; j++) {
          const s = NAV_POLITE_SUFFIXES[j];
          if (rest === s || rest.slice(-s.length) === s && rest.length <= 16) {
            return true;
          }
        }
      }
    }
    return false;
  }

  const NAV_CONTAINERS = new Set([
    'sekme', 'sayfa', 'bolum', 'ekran', 'menu', 'kisim', 'alan', 'tab',
    'kart', 'gorunum', 'kamera', 'aci', 'yer', 'sahne', 'grafik', 'grafik',
    'panel', 'liste', 'mod', 'ozet', 'taraf', 'kose', 'nokta', 'kategori'
  ]);

  function isNavContainer(tok, stems) {
    if (NAV_CONTAINERS.has(tok)) return true;
    for (const s of stems) {
      if (NAV_CONTAINERS.has(s)) return true;
    }
    return false;
  }

  const FILLERS = new Set([
    'lutfen', 'bi', 'bir', 'bana', 'beni', 'benim', 'simdi', 'hemen', 'su',
    'an', 'acaba', 'rica', 'etsem', 'ederim', 'misin', 'musun', 'misiniz',
    'musunuz', 'miyim', 'muyum', 'mi', 'mu', 'ya', 'da', 'de', 've', 'ile',
    'icin', 'hey', 'merhaba', 'selam', 'dd', 'uygulama', 'uygulamada',
    'burada', 'oraya', 'buraya', 'yap', 'et', 'ver', 'ol', 'etmek', 'yapmak',
    'istiyorum', 'isterim', 'lazim', 'gerek', 'hadi', 'haydi', 'tum', 'butun',
    'geri', 'tekrar', 'yeniden', 'biraz', 'hepsi', 'son', 'ilk', 'ana',
    'canli', 'hizli', 'hizlica', 'otomatik', 'olarak', 'uzerinden', 'dogru'
  ]);

  function isFiller(tok, stems) {
    if (FILLERS.has(tok)) return true;
    for (const s of stems) {
      if (FILLERS.has(s)) return true;
    }
    return false;
  }

  function hasAnyToken(ctx, list) {
    const tokens = ctx.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const stems = ctx.tokenStems[i];
      for (let j = 0; j < list.length; j++) {
        const w = list[j];
        if (tok === w || stems.has(w)) return true;
      }
    }
    return false;
  }

  function hasPhrase(ctx, phrase) {
    const pWords = normalizeTokens(phrase);
    if (!pWords.length || ctx.tokens.length < pWords.length) return false;
    for (let i = 0; i <= ctx.tokens.length - pWords.length; i++) {
      let ok = true;
      for (let k = 0; k < pWords.length; k++) {
        const w = pWords[k];
        if (ctx.tokens[i + k] !== w && !ctx.tokenStems[i + k].has(w)) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }

  function hasFuzzyAny(ctx, list) {
    if (hasAnyToken(ctx, list)) return true;
    const tokens = ctx.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      for (let j = 0; j < list.length; j++) {
        if (fuzzyTokenMatch(tok, list[j]) !== -1) return true;
      }
    }
    return false;
  }

  /* ------------------------------------------- Türkçe sayısal değer ayrıştırma */

  const NUMBER_WORDS = {
    sifir: 0, bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9,
    on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, yetmis: 70, seksen: 80, doksan: 90,
    yuz: 100
  };

  function parseNumberInfo(ctx) {
    const tokens = ctx.tokens;
    const isPercent = hasAnyToken(ctx, ['yuzde']);
    let numeric = null;

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (/^\d+$/.test(tok)) {
        numeric = parseInt(tok, 10);
        break;
      }
    }

    if (numeric === null) {
      let acc = 0;
      let seen = false;
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        /* "yüzde elli" içindeki "yüzde" sözcüğünü 100 sanma */
        if (tok === 'yuzde') continue;
        const val = NUMBER_WORDS[tok];
        if (val !== undefined) {
          seen = true;
          if (val === 100 && acc > 0 && acc < 10) acc = acc * 100;
          else acc += val;
        } else if (seen) {
          break;
        }
      }
      if (seen) numeric = acc;
    }

    return { value: numeric, isPercent: isPercent };
  }

  /* ------------------------------ Eylem sözlükleri (token/kök bazlı, güvenli) */

  const OPEN_WORDS = [
    'ac', 'acar', 'acik', 'aciver', 'acsana', 'acalim', 'acin', 'aciniz',
    'calistir', 'calis', 'baslat', 'aktif', 'etkinlestir', 'etkin', 'yukari', 'yukselt', 'kaldir', 'fulle'
  ];
  const CLOSE_WORDS = [
    'kapat', 'kapa', 'kapatir', 'kapativer', 'kapasit', 'kapali', 'sustur', 'sus',
    'durdur', 'kes', 'indir', 'off', 'devre', 'pasif', 'sessiz', 'sessize', 'kis'
  ];
  const STOP_WORDS = ['serbest', 'birak', 'bekle', 'durdur', 'dur'];
  const AJAR_WORDS = ['arala', 'aralik', 'yari', 'yarim', 'ortala', 'az'];
  const CLEAR_WORDS = ['temizle', 'sifirla', 'iptal', 'sondur', 'sil'];
  const TEST_WORDS = ['test', 'simule', 'deneme', 'tatbikat'];
  const TOGGLE_WORDS = ['degistir', 'tersine', 'cevir', 'gec'];

  /* -------------------------------------- Hedef / Sekme / Sayfa / Oda kataloğu */

  const DESTINATIONS = [
    /* Dashboard ana sekmeleri (index.html) */
    {
      id: 'hero',
      kind: 'panel',
      page: 'index',
      targetId: 'hero',
      label: 'Panel',
      toast: 'Panel açıldı.',
      aliases: [
        'panel', 'ana sayfa', 'anasayfa', 'ana ekran', 'genel bakis',
        'ev ozeti', 'kontrol paneli', 'baslangic', 'giris ekrani',
        'home', 'dashboard', 'ana menu', 'on ekran'
      ]
    },
    {
      id: 'telemetry',
      kind: 'panel',
      page: 'index',
      targetId: 'telemetry',
      label: 'Sensörler',
      toast: 'Sensörler sekmesi açıldı.',
      aliases: [
        'sensor', 'sensorler', 'canli sensorler', 'telemetri', 'olcum',
        'olcumler', 'veriler', 'canli veriler', 'sensor degerleri',
        'hava kalitesi', 'sensor ozeti', 'sensor verileri'
      ]
    },
    {
      id: 'command-center',
      kind: 'panel',
      page: 'index',
      targetId: 'command-center',
      label: 'Kontrol',
      toast: 'Kontrol sekmesi açıldı.',
      aliases: [
        'kontrol', 'cihaz kontrolu', 'cihaz kontrol', 'kumanda',
        'komut merkezi', 'kontrol merkezi', 'aktuator', 'aktuatorler',
        'kontroller', 'yonetim', 'manuel kontrol', 'cihaz yonetimi'
      ]
    },
    {
      id: 'analytics',
      kind: 'panel',
      page: 'index',
      targetId: 'analytics',
      label: 'Geçmiş',
      toast: 'Geçmiş sekmesi açıldı.',
      aliases: [
        'gecmis', 'sensor gecmisi', 'grafik', 'grafikler', 'analiz',
        'analitik', 'son 24 saat', '24 saat', 'zaman serisi', 'egri',
        'egriler', 'istatistik', 'istatistikler', 'gecmis veriler'
      ]
    },
    {
      id: 'diagnostics',
      kind: 'panel',
      page: 'index',
      targetId: 'diagnostics',
      label: 'Sistem',
      toast: 'Sistem sağlığı sekmesi açıldı.',
      aliases: [
        'sistem', 'sistem sagligi', 'sistem teshisi', 'teshis', 'donanim',
        'kart durumu', 'baglanti durumu', 'tanilama', 'diagnostics',
        'bellek', 'ram', 'sinyal', 'wifi durumu', 'cihaz bilgisi'
      ]
    },

    /* Dashboard alt kartları (index.html içinde odaklanma) */
    {
      id: 'gasCard',
      kind: 'card',
      page: 'index',
      targetId: 'gasCard',
      label: 'Gaz ve duman',
      toast: 'Gaz ve duman sensörüne geçildi.',
      aliases: ['gaz sensoru', 'gaz karti', 'gaz ve duman', 'gaz seviyesi', 'duman sensoru', 'mq2', 'mq 2']
    },
    {
      id: 'flameCard',
      kind: 'card',
      page: 'index',
      targetId: 'flameCard',
      label: 'Alev sensörü',
      toast: 'Alev sensörüne geçildi.',
      aliases: ['alev sensoru', 'alev karti', 'yangin sensoru', 'yangin karti']
    },
    {
      id: 'rainCard',
      kind: 'card',
      page: 'index',
      targetId: 'rainCard',
      label: 'Yağmur sensörü',
      toast: 'Yağmur ve su sensörüne geçildi.',
      aliases: ['yagmur sensoru', 'yagmur karti', 'su sensoru', 'su baskini sensoru', 'sel sensoru']
    },
    {
      id: 'vibCard',
      kind: 'card',
      page: 'index',
      targetId: 'vibCard',
      label: 'Sarsıntı sensörü',
      toast: 'Sarsıntı sensörüne geçildi.',
      aliases: ['sarsinti sensoru', 'titresim sensoru', 'sarsinti karti', 'titresim karti']
    },
    {
      id: 'soundControl',
      kind: 'card',
      page: 'index',
      targetId: 'soundControl',
      label: 'Siren ve ses',
      toast: 'Siren ve ses kontrolüne geçildi.',
      aliases: ['siren ve ses', 'siren ve ses kontrolu', 'ses kontrolu', 'hoparlor kontrolu']
    },
    {
      id: 'blackboxWrap',
      kind: 'card',
      page: 'index',
      targetId: 'blackboxWrap',
      label: 'Olay oynatıcı',
      toast: 'Olay oynatıcı (kara kutu) açıldı.',
      aliases: ['kara kutu', 'karakutu', 'olay oynatici', 'blackbox', 'kayit oynatici', 'tekrar oynatici']
    },

    /* Bağımsız sayfalar */
    {
      id: 'events',
      kind: 'page',
      page: 'events',
      label: 'Olaylar',
      toast: 'Olaylar sayfası açılıyor.',
      aliases: [
        'olay', 'olaylar', 'olay gunlugu', 'olay akisi', 'olay kayitlari',
        'alarm gecmisi', 'alarm kayitlari', 'kayitlar', 'gunluk',
        'bildirim gecmisi', 'log', 'loglar'
      ]
    },
    {
      id: 'earthquake',
      kind: 'page',
      page: 'earthquake',
      label: 'Deprem',
      toast: 'Deprem izleme sayfası açılıyor.',
      aliases: [
        'deprem', 'depremler', 'deprem izleme', 'deprem haritasi',
        'deprem takibi', 'son depremler', 'sismik', 'sismik akis',
        'emsc', 'afet'
      ]
    },
    {
      id: 'settings',
      kind: 'settings',
      page: 'settings',
      panelId: '',
      label: 'Ayarlar',
      toast: 'Ayarlar açılıyor.',
      aliases: [
        'ayar', 'ayarlar', 'sistem ayarlari', 'cihaz ayarlari',
        'uygulama ayarlari', 'tercihler', 'yapilandirma', 'kurulum',
        'settings', 'konfigurasyon'
      ]
    },
    {
      id: 'privacy',
      kind: 'page',
      page: 'privacy',
      label: 'Gizlilik Politikası',
      toast: 'Gizlilik politikası açılıyor.',
      aliases: ['gizlilik', 'gizlilik politikasi', 'gizlilik ve hesap silme', 'kvkk', 'kisisel veriler', 'veri koruma', 'mahremiyet', 'privacy']
    },
    {
      id: 'accountDelete',
      kind: 'page',
      page: 'privacy',
      hash: '#hesap-silme',
      label: 'Hesap silme',
      toast: 'Hesap silme bölümü açılıyor.',
      aliases: ['hesap silme', 'hesabimi sil', 'hesabi sil', 'hesap kapatma', 'veri silme']
    },
    {
      id: 'terms',
      kind: 'page',
      page: 'terms',
      label: 'Kullanım Koşulları',
      toast: 'Kullanım koşulları açılıyor.',
      aliases: ['kullanim kosullari', 'kullanim sartlari', 'kosullar', 'sartlar', 'sozlesme', 'yasal', 'terms']
    },

    /* Ayarlar alt bölümleri (settings.html panelleri) */
    {
      id: 'accountCard',
      kind: 'settings',
      page: 'settings',
      panelId: 'accountCard',
      label: 'Hesap ve roller',
      toast: 'Hesap ve roller bölümü açıldı.',
      aliases: [
        'hesap', 'hesabim', 'hesap ve roller', 'oturum', 'giris yap',
        'hesaba giris', 'hesap ayarlari', 'roller', 'yetkiler', 'kullanici hesabi', 'account'
      ]
    },
    {
      id: 'profileCard',
      kind: 'settings',
      page: 'settings',
      panelId: 'profileCard',
      label: 'Profilim',
      toast: 'Profilim bölümü açıldı.',
      aliases: ['profil', 'profilim', 'profil ayarlari', 'kisisel bilgiler', 'sifre degistir', 'parola degistir', 'hesap bilgilerim']
    },
    {
      id: 'inviteCard',
      kind: 'settings',
      page: 'settings',
      panelId: 'inviteCard',
      label: 'Davetler',
      toast: 'Davetler bölümü açıldı.',
      aliases: ['davet', 'davetler', 'davet kodu', 'davet kodlari', 'davetiye', 'kullanici davet']
    },
    {
      id: 'devicesSection',
      kind: 'settings',
      page: 'settings',
      panelId: 'devicesSection',
      label: 'Cihazlarım',
      toast: 'Cihazlarım bölümü açıldı.',
      aliases: ['cihaz', 'cihazlar', 'cihazlarim', 'cihaz listesi', 'kartlarim', 'bagli cihazlar', 'cihaz bagla', 'cihaz degistir', 'deneyap kart']
    },
    {
      id: 'homesSection',
      kind: 'settings',
      page: 'settings',
      panelId: 'homesSection',
      label: 'Ev ve aile erişimi',
      toast: 'Ev ve aile erişimi bölümü açıldı.',
      aliases: ['ev ve aile', 'aile', 'aile erisimi', 'aile uyeleri', 'ev paylasimi', 'ev erisimi', 'evler', 'evlerim', 'paylasim']
    },
    {
      id: 'otaSection',
      kind: 'settings',
      page: 'settings',
      panelId: 'otaSection',
      label: 'Cihaz yazılımı',
      toast: 'Cihaz yazılımı (OTA) bölümü açıldı.',
      aliases: ['cihaz yazilimi', 'yazilim', 'yazilim guncelleme', 'guncelleme', 'firmware', 'ota']
    },
    {
      id: 'connSection',
      kind: 'settings',
      page: 'settings',
      panelId: 'connSection',
      label: 'Ev ağı bağlantısı',
      toast: 'Ev ağı bağlantısı ayarları açıldı.',
      aliases: ['baglanti', 'ev agi', 'ev agina', 'ev agini', 'ev agi baglantisi', 'ev agi baglantisini', 'ag baglantisi', 'ag ayarlari', 'baglanti ayarlari', 'mqtt', 'mqtt ayarlari', 'sunucu ayarlari', 'wifi ayarlari', 'wi fi ayarlari', 'internet ayarlari']
    },
    {
      id: 'thresholdSection',
      kind: 'settings',
      page: 'settings',
      panelId: 'thresholdSection',
      label: 'Sensör eşikleri',
      toast: 'Sensör eşikleri bölümü açıldı.',
      aliases: ['esik', 'esikler', 'sensor esikleri', 'gaz esigi', 'alarm esigi', 'alarm esikleri', 'hassasiyet', 'esik ayarlari']
    },
    {
      id: 'automationSection',
      kind: 'settings',
      page: 'settings',
      panelId: 'automationSection',
      label: 'Çalışma modları ve zamanlama',
      toast: 'Çalışma modları ve zamanlama açıldı.',
      aliases: ['zamanlama', 'zamanlayici', 'takvim', 'program', 'mod zamanlama', 'calisma modlari', 'otomasyon kurallari', 'kurallar', 'otomasyon ayarlari']
    },
    {
      id: 'telegramSection',
      kind: 'settings',
      page: 'settings',
      panelId: 'telegramSection',
      label: 'Telegram bildirimleri',
      toast: 'Telegram bildirim ayarları açıldı.',
      aliases: ['telegram', 'telegram bildirimleri', 'telegram ayarlari', 'telegram bot']
    },
    {
      id: 'notifySection',
      kind: 'settings',
      page: 'settings',
      panelId: 'notifySection',
      label: 'Bildirimler',
      toast: 'Bildirim ayarları açıldı.',
      aliases: ['bildirim', 'bildirimler', 'bildirim ayarlari', 'uyari ayarlari', 'sesli bildirim ayarlari', 'ses ayarlari']
    },
    {
      id: 'nativeNotifySection',
      kind: 'settings',
      page: 'settings',
      panelId: 'nativeNotifySection',
      label: 'Uygulama bildirimleri',
      toast: 'Uygulama bildirimleri bölümü açıldı.',
      aliases: ['uygulama bildirimleri', 'push bildirimleri', 'push', 'mobil bildirimler', 'telefon bildirimleri', 'anlik bildirim']
    },
    {
      id: 'emergencySection',
      kind: 'settings',
      page: 'settings',
      panelId: 'emergencySection',
      label: 'Acil durum e-postaları',
      toast: 'Acil durum e-postaları açıldı.',
      aliases: ['acil durum', 'acil durum e postalari', 'acil durum epostalar', 'acil kisiler', 'acil iletisim', 'acil e posta', 'acil eposta', 'e posta', 'eposta', 'e posta ayarlari', 'acil durum kisileri']
    },
    {
      id: 'themeSection',
      kind: 'settings',
      page: 'settings',
      panelId: 'themeSection',
      label: 'Görünüm',
      toast: 'Görünüm ayarları açıldı.',
      aliases: ['gorunum', 'gorunum ayarlari', 'tema ayarlari', 'ekran ayarlari', 'arayuz ayarlari']
    },
    {
      id: 'backupSection',
      kind: 'settings',
      page: 'settings',
      panelId: 'backupSection',
      label: 'Yedekleme ve bakım',
      toast: 'Yedekleme ve bakım bölümü açıldı.',
      aliases: ['yedekleme', 'yedek', 'yedekleme ve bakim', 'bakim', 'disa aktar', 'ice aktar']
    },

    /* 3D Ev Sahnesi Konumları ve Odaları */
    {
      id: 'overview',
      kind: 'room',
      page: 'index',
      preset: 'overview',
      label: 'Genel görünüm',
      toast: '3D ev genel görünümüne geçildi.',
      aliases: ['genel gorunum', 'tum ev', 'tum evi', 'tum eve', 'ev gorunumu', 'evi goster', 'evimi goster', 'eve', 'eve don', '3d ev', '3d evi', '3d ev sahnesi', 'uc boyutlu ev', 'kamerayi sifirla', 'kamera sifirla', 'uzaklas', 'dis gorunum', 'genel']
    },
    {
      id: 'salon',
      kind: 'room',
      page: 'index',
      preset: 'salon',
      label: 'Salon',
      toast: '3D kamera salona odaklandı.',
      aliases: ['salon', 'oturma odasi', 'oturma alani']
    },
    {
      id: 'kitchen',
      kind: 'room',
      page: 'index',
      preset: 'kitchen',
      label: 'Mutfak',
      toast: '3D kamera mutfağa odaklandı.',
      aliases: ['mutfak', 'yemek alani', 'yemek odasi']
    },
    {
      id: 'bedroom',
      kind: 'room',
      page: 'index',
      preset: 'bedroom',
      label: 'Yatak odası',
      toast: '3D kamera yatak odasına odaklandı.',
      aliases: ['yatak odasi', 'ust kat', 'yatak']
    },
    {
      id: 'garden',
      kind: 'room',
      page: 'index',
      preset: 'garden',
      label: 'Bahçe',
      toast: '3D kamera bahçeye odaklandı.',
      aliases: ['bahce', 'dis mekan', 'avlu', 'veranda', 'disari']
    }
  ];

  /* Alias'ları başlangıçta bir kez derle */
  const COMPILED_DESTS = DESTINATIONS.map(function (dest) {
    const compiledAliases = dest.aliases.map(function (alias) {
      const words = alias.split(' ').filter(Boolean);
      const wordStems = words.map(function (w) { return stemCandidates(w); });
      return { text: alias, words: words, wordStems: wordStems };
    });
    return Object.assign({}, dest, { compiledAliases: compiledAliases });
  });

  function setsIntersect(a, b) {
    for (const v of a) {
      if (b.has(v)) return true;
    }
    return false;
  }

  function matchSingleToken(tok, tokStems, aliasWord, aliasStems) {
    if (tok === aliasWord) return { kind: 'exact', penalty: 0 };
    if (tokStems.has(aliasWord) || setsIntersect(tokStems, aliasStems)) {
      return { kind: 'stem', penalty: 4 };
    }
    /* Kullanıcı kısa önek dışında bulanık arama (örn. "kontorl" -> "kontrol") */
    const d = fuzzyTokenMatch(tok, aliasWord);
    if (d !== -1) return { kind: 'fuzzy', penalty: d === 1 ? 14 : 26 };
    for (const st of tokStems) {
      if (st === tok) continue;
      const ds = fuzzyTokenMatch(st, aliasWord);
      if (ds !== -1) return { kind: 'fuzzy', penalty: ds === 1 ? 16 : 28 };
    }
    return null;
  }

  function matchDestination(ctx) {
    const tokens = ctx.tokens;
    const tokenStems = ctx.tokenStems;
    let best = null;

    for (let d = 0; d < COMPILED_DESTS.length; d++) {
      const dest = COMPILED_DESTS[d];
      for (let a = 0; a < dest.compiledAliases.length; a++) {
        const al = dest.compiledAliases[a];
        const L = al.words.length;
        if (tokens.length < L) continue;

        for (let start = 0; start <= tokens.length - L; start++) {
          let totalPenalty = 0;
          let matchedOk = true;
          let exactCount = 0;
          let fuzzyCount = 0;

          for (let k = 0; k < L; k++) {
            const m = matchSingleToken(
              tokens[start + k],
              tokenStems[start + k],
              al.words[k],
              al.wordStems[k]
            );
            if (!m) {
              matchedOk = false;
              break;
            }
            totalPenalty += m.penalty;
            if (m.kind === 'exact') exactCount += 1;
            if (m.kind === 'fuzzy') fuzzyCount += 1;
          }
          if (!matchedOk) continue;

          /* Eşleşmeyen diğer kelimelerin hepsi navigasyon fiili, kaplayıcı isim veya dolgu olmalı */
          let leftoversValid = true;
          let navVerbCount = 0;
          for (let i = 0; i < tokens.length; i++) {
            if (i >= start && i < start + L) continue;
            const tok = tokens[i];
            const st = tokenStems[i];
            if (isNavVerb(tok)) {
              navVerbCount += 1;
            } else if (isNavContainer(tok, st) || isFiller(tok, st)) {
              /* izinli yardımcı kelime */
            } else {
              leftoversValid = false;
              break;
            }
          }
          if (!leftoversValid) continue;

          /* Bulanık çoklu eşleşmelerde sahte pozitifleri engelle */
          if (L === 1 && tokens.length >= 4 && fuzzyCount > 0) continue;

          const base = 70 + (L * 35) + (exactCount * 8) + (navVerbCount > 0 ? 12 : 0) - totalPenalty;
          /* İkiye eşit skorda spesifik hedefler (kart/ayar alt bölümü) genel olandan önce gelsin */
          const specificity = dest.kind === 'card' || (dest.kind === 'settings' && dest.panelId) || dest.kind === 'room' ? 2 : 0;
          const score = base + specificity;

          if (!best || score > best.score) {
            best = { dest: dest, score: score, exact: fuzzyCount === 0 };
          }
        }
      }
    }

    return best;
  }

  /* --------------------------------------------------- Sesli geri bildirim */

  function speakFeedback(msg) {
    if (!msg) return;
    if (App.Automation && !App.Automation.ttsAllowed()) return;
    if (App.voice && App.voice.speak) App.voice.speak(msg);
  }

  /* ---------------------------------------------- Cihaz izni ve API kontrolü */

  function deviceAllowed() {
    let t = null;
    try { t = App.lastTelemetry ? App.lastTelemetry() : null; } catch (e) { t = null; }
    if (t && t.dev && App.Auth && App.Auth.canControl && !App.Auth.canControl(t.dev)) return false;
    if (typeof App.canControlDevice === 'function' && !App.canControlDevice()) return false;
    return true;
  }

  function refuse() {
    let t = null;
    try { t = App.lastTelemetry ? App.lastTelemetry() : null; } catch (e) { t = null; }
    if (t && t.dev && App.Auth && App.Auth.canControl && !App.Auth.canControl(t.dev)) {
      if (App.toast) App.toast('Bu cihaz başka bir hesaba bağlı — komut reddedildi.', { kind: 'warn' });
      speakFeedback('Bu cihazı yönetme yetkiniz yok.');
      return;
    }
    const msg = 'Komut göndermek için önce giriş yapıp cihazınızı bağlayın.';
    if (App.toast) App.toast(msg, { kind: 'warn', duration: 3800 });
    speakFeedback('Cihaz bağlı değil.');
  }

  function run(device, action, value, okMsg) {
    if (!deviceAllowed()) { refuse(); return Promise.resolve(false); }
    if (!App.api || typeof App.api.control !== 'function') {
      if (App.toast) App.toast('Bu sayfada cihaz kontrol bağlantısı yüklü değil.', { kind: 'warn' });
      return Promise.resolve(false);
    }
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

  function reportStatus() {
    if (!deviceAllowed()) { refuse(); return; }
    if (!App.api || typeof App.api.status !== 'function') {
      if (App.toast) App.toast('Durum sorgusu için ana panele geçin.', { kind: 'warn' });
      return;
    }
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

  /* --------------------------------------------------- Sayfa ve DOM yönlendirme */

  function currentPage() {
    try {
      const p = toLowerTr((window.location && window.location.pathname) || '');
      const cl = document.body && document.body.classList;
      if ((cl && cl.contains('quake-body')) || p.indexOf('earthquake') !== -1) return 'earthquake';
      if ((cl && cl.contains('events-body')) || p.indexOf('events') !== -1) return 'events';
      if ((cl && cl.contains('settings-studio-body')) || p.indexOf('settings') !== -1) return 'settings';
      if (p.indexOf('privacy') !== -1) return 'privacy';
      if (p.indexOf('terms') !== -1) return 'terms';
    } catch (e) { /* yoksay */ }
    return 'index';
  }

  function cleanUrlsActive() {
    try {
      const hintEl = document.querySelector('.nav-settings-pill, .header-nav a[href*="events"], .bottom-nav a[href*="events"], a[href*="settings"]');
      if (hintEl) {
        const href = hintEl.getAttribute('href') || '';
        if (href && href.indexOf('.html') === -1) return true;
      }
    } catch (e) { /* yoksay */ }
    return false;
  }

  function pageHref(pageName, hash) {
    const ext = cleanUrlsActive() ? '' : '.html';
    const base = pageName === 'index' ? './' : ('./' + pageName + ext);
    return base + (hash || '');
  }

  let customNavigator = null;

  function defaultNavigator() {
    return {
      goUrl: function (url) {
        if (typeof window !== 'undefined' && window.location) {
          window.location.href = url;
        }
      },
      navigatePanel: function (id) {
        if (App.navigatePanel) return App.navigatePanel(id);
        const target = document.getElementById(id);
        if (target && target.scrollIntoView) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return true;
        }
        return false;
      },
      showSettingsPanel: function (id) {
        if (App.StudioNav && App.StudioNav.show) return App.StudioNav.show(id);
        return false;
      },
      showSettingsOverview: function () {
        if (App.StudioNav && App.StudioNav.showOverview) {
          App.StudioNav.showOverview();
          return true;
        }
        return false;
      },
      focusRoom: function (preset) {
        if (App.navigatePanel) App.navigatePanel('hero');
        if (App.House3D && App.House3D.focusView) {
          App.House3D.focusView(preset);
          return true;
        }
        return false;
      },
      savePendingRoom: function (preset) {
        try {
          if (typeof window !== 'undefined' && window.sessionStorage) {
            window.sessionStorage.setItem('deneyap_house3d_focus', preset);
          }
        } catch (e) { /* yoksay */ }
      }
    };
  }

  function getNav() {
    return customNavigator || defaultNavigator();
  }

  function executeDestination(dest) {
    const nav = getNav();
    const page = currentPage();

    if (dest.kind === 'room') {
      if (page === 'index') {
        nav.focusRoom(dest.preset);
        if (App.toast) App.toast(dest.toast, { kind: 'ok', duration: 2400 });
        if (App.sound && App.sound.click) App.sound.click();
        speakFeedback(dest.toast);
      } else {
        nav.savePendingRoom(dest.preset);
        if (App.toast) App.toast(dest.toast, { kind: 'ok', duration: 2000 });
        nav.goUrl(pageHref('index', '#hero'));
      }
      return 'room:' + dest.id;
    }

    if (dest.kind === 'panel' || dest.kind === 'card') {
      if (page === 'index') {
        const ok = nav.navigatePanel(dest.targetId);
        if (ok && dest.kind === 'card') {
          const el = document.getElementById(dest.targetId);
          if (el && !el.closest('[hidden]') && el.scrollIntoView) {
            try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
          }
        }
        if (App.toast) App.toast(dest.toast, { kind: 'ok', duration: 2400 });
        if (App.sound && App.sound.click) App.sound.click();
        speakFeedback(dest.toast);
      } else {
        if (App.toast) App.toast(dest.toast, { kind: 'ok', duration: 2000 });
        nav.goUrl(pageHref('index', '#' + dest.targetId));
      }
      return 'nav:' + dest.id;
    }

    if (dest.kind === 'settings') {
      if (page === 'settings') {
        let ok = true;
        if (dest.panelId) {
          ok = nav.showSettingsPanel(dest.panelId);
          if (!ok) {
            if (App.toast) App.toast('Bu bölüm mevcut hesap veya yetki durumunuzda kapalı.', { kind: 'warn', duration: 3200 });
            return 'nav:settings:unavailable:' + dest.panelId;
          }
        } else {
          nav.showSettingsOverview();
        }
        if (App.toast) App.toast(dest.toast, { kind: 'ok', duration: 2400 });
        if (App.sound && App.sound.click) App.sound.click();
        speakFeedback(dest.toast);
      } else {
        if (App.toast) App.toast(dest.toast, { kind: 'ok', duration: 2000 });
        nav.goUrl(pageHref('settings', dest.panelId ? '#' + dest.panelId : ''));
      }
      return dest.panelId ? ('nav:settings:' + dest.panelId) : 'nav:settings';
    }

    /* Bağımsız sayfa: events, earthquake, privacy, terms */
    if (page === dest.page) {
      if (dest.hash) {
        const el = document.getElementById(dest.hash.replace(/^#/, ''));
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (typeof window !== 'undefined' && window.scrollTo) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (App.toast) App.toast(dest.toast || (dest.label + ' açık.'), { kind: 'ok', duration: 2200 });
      if (App.sound && App.sound.click) App.sound.click();
    } else {
      if (App.toast) App.toast(dest.toast, { kind: 'ok', duration: 2000 });
      nav.goUrl(pageHref(dest.page, dest.hash || ''));
    }
    return 'nav:' + dest.id;
  }

  /* ---------------------------------------------- Saf komut ayrıştırıcı (NLU) */

  function detectMode(ctx) {
    /* "çalışma modları" / "mod zamanlama" gibi ayarlar bölümüne giden ifadeleri mod değişimi sanma */
    if (hasAnyToken(ctx, ['zamanlama', 'zamanlayici', 'takvim', 'ayar', 'ayarlar', 'kural'])) {
      return null;
    }
    let m = null;
    if (hasAnyToken(ctx, ['gece', 'uyku'])) m = 'night';
    else if (hasAnyToken(ctx, ['tatil', 'seyahat', 'yokluk', 'tatile'])) m = 'away';
    else if (hasAnyToken(ctx, ['evde', 'evdeyim']) || hasPhrase(ctx, 'normal mod')) m = 'home';
    else if (hasAnyToken(ctx, ['izleme', 'monitor'])) m = 'off';
    else if (hasAnyToken(ctx, ['kapali']) && hasAnyToken(ctx, ['mod'])) m = 'off';

    if (!m) return null;
    return m;
  }

  function hasExplicitHardwareNavContext(ctx) {
    /* "gaz kartını aç", "alev sensörüne git", "ses kontrolünü aç" vb. net navigasyon bağlamı */
    if (hasAnyToken(ctx, ['kart', 'sekme', 'sayfa', 'bolum'])) return true;
    const onlyNavVerbs = ['gir', 'git', 'gec', 'goster', 'bak', 'incele', 'goruntule', 'izle', 'odaklan', 'getir', 'listele', 'don'];
    if (hasAnyToken(ctx, onlyNavVerbs) && !hasAnyToken(ctx, ['kapat', 'kapa', 'durdur', 'sustur', 'temizle', 'test', 'simule', 'cal', 'calistir'])) {
      return true;
    }
    return false;
  }

  function buildContext(raw) {
    const tokens = normalizeTokens(raw);
    const tokenStems = tokens.map(stemCandidates);
    return {
      raw: String(raw || ''),
      tokens: tokens,
      tokenStems: tokenStems
    };
  }

  function parse(raw) {
    const ctx = buildContext(raw);
    if (!ctx.tokens.length) return { type: 'empty', code: 'empty', score: 0 };

    const navMatch = matchDestination(ctx);
    const hasOpen = hasFuzzyAny(ctx, OPEN_WORDS);
    const hasClose = hasFuzzyAny(ctx, CLOSE_WORDS);
    const hasStop = hasFuzzyAny(ctx, STOP_WORDS);
    const hasAjar = hasFuzzyAny(ctx, AJAR_WORDS);
    const hasClear = hasFuzzyAny(ctx, CLEAR_WORDS);
    const hasTest = hasFuzzyAny(ctx, TEST_WORDS);
    const hasToggle = hasFuzzyAny(ctx, TOGGLE_WORDS);
    const numInfo = parseNumberInfo(ctx);

    /* 1) Acil durum alarm simülasyonu */
    if (hasTest && hasAnyToken(ctx, ['alarm', 'genel']) && !hasAnyToken(ctx, ['esik', 'gecmis', 'kayit'])) {
      return { type: 'device', device: 'test', action: 'simulate_alarm', value: 0, okMsg: 'Alarm simülasyonu başlatıldı.', code: 'simulate', score: 110 };
    }
    if (hasTest && hasAnyToken(ctx, ['gaz', 'duman'])) {
      return { type: 'device', device: 'test', action: 'simulate_alarm', value: 0, okMsg: 'Alarm simülasyonu başlatıldı.', code: 'simulate', score: 108 };
    }

    /* 2) Gaz kalibrasyonu */
    if (hasAnyToken(ctx, ['kalibre', 'kalibrasyon', 'taban']) && !hasAnyToken(ctx, ['esik', 'ayar'])) {
      return { type: 'device', device: 'gas', action: 'recalibrate', value: 0, okMsg: 'Gaz sensörü tabanı yeniden ölçülüyor.', code: 'calibrate', score: 108 };
    }

    /* 3) Durum raporu ("acil durum", "alev durumunu temizle", "kart durumunu aç" ile çakışmasın) */
    if (!hasAnyToken(ctx, ['acil', 'yedek', 'bakim']) &&
        !hasAnyToken(ctx, CLEAR_WORDS) &&
        !hasAnyToken(ctx, TEST_WORDS) &&
        hasAnyToken(ctx, ['durum', 'rapor', 'ozet', 'nasil', 'nedir', 'guvende'])) {
      if (!navMatch || hasAnyToken(ctx, ['rapor', 'nasil', 'nedir', 'guvende']) ||
          (hasAnyToken(ctx, ['durum']) && !hasAnyToken(ctx, ['ac', 'goster', 'gir', 'git', 'gec', 'bak', 'baglanti', 'kart']))) {
        return { type: 'status', code: 'status', score: 105 };
      }
    }
    if (hasPhrase(ctx, 'kac ppm')) {
      return { type: 'status', code: 'status', score: 105 };
    }

    /* 4) Tema ve 3D gündüz/gece görünümü */
    if (!hasAnyToken(ctx, ['ayar', 'ayarlar', 'gorunum'])) {
      if (hasAnyToken(ctx, ['amoled', 'karanlik', 'koyu', 'siyah']) && hasAnyToken(ctx, ['tema', 'mod', 'renk'])) {
        const tMode = hasAnyToken(ctx, ['amoled', 'siyah']) ? 'amoled' : 'dark';
        return { type: 'theme', theme: tMode, code: 'theme:' + tMode, score: 104 };
      }
      if (hasAnyToken(ctx, ['aydinlik', 'acik', 'beyaz']) && hasAnyToken(ctx, ['tema'])) {
        return { type: 'theme', theme: 'light', code: 'theme:light', score: 104 };
      }
      if (hasAnyToken(ctx, ['gunduz']) && hasAnyToken(ctx, ['tema'])) {
        return { type: 'theme', theme: 'light', code: 'theme:light', score: 104 };
      }
      if (hasAnyToken(ctx, ['gece']) && hasAnyToken(ctx, ['tema'])) {
        return { type: 'theme', theme: 'dark', code: 'theme:dark', score: 104 };
      }
      if (hasAnyToken(ctx, ['tema']) && hasToggle) {
        return { type: 'theme', theme: 'toggle', code: 'theme:toggle', score: 102 };
      }
      if ((hasAnyToken(ctx, ['3d', 'ev', 'gorunum']) && hasAnyToken(ctx, ['gece'])) && !hasAnyToken(ctx, ['mod'])) {
        return { type: 'house3d', action: 'night', code: 'house3d:night', score: 100 };
      }
      if ((hasAnyToken(ctx, ['3d', 'ev', 'gorunum']) && hasAnyToken(ctx, ['gunduz'])) && !hasAnyToken(ctx, ['mod'])) {
        return { type: 'house3d', action: 'day', code: 'house3d:day', score: 100 };
      }
    }

    /* 5) Çalışma modları */
    const mode = detectMode(ctx);
    if (mode && (hasAnyToken(ctx, ['mod', 'uyku', 'tatile', 'evdeyim', 'seyahat']) ||
        !hasAnyToken(ctx, ['pencere', 'cam', 'panjur', 'perde', 'fan', 'pompa', 'motor', 'siren', 'ses', 'tema']))) {
      return { type: 'mode', mode: mode, code: 'mode:' + mode, score: 102 };
    }

    /* 6) Pencere kontrolü (kapatma yalnız SHUTTER_CLOSE, durdur ise stop) */
    const hasShutterClose = hasFuzzyAny(ctx, ['kapat', 'kapa', 'kapatir', 'kapativer', 'kapali', 'indir']);
    if (hasFuzzyAny(ctx, ['pencere', 'cam', 'davlumbaz'])) {
      if (hasStop && !hasShutterClose) {
        return { type: 'device', device: 'window', action: 'stop', value: 0, okMsg: 'Pencere serbest bırakıldı.', code: 'window:stop', score: 102 };
      }
      if (hasShutterClose) {
        return { type: 'device', device: 'window', action: 'shut', value: 0, okMsg: 'Pencere kapatıldı.', code: 'window:shut', score: 102 };
      }
      if (numInfo.value !== null) {
        const deg = numInfo.isPercent
          ? Math.max(0, Math.min(180, Math.round(numInfo.value * 1.8)))
          : Math.max(0, Math.min(180, Math.round(numInfo.value)));
        return { type: 'device', device: 'window', action: 'set', value: deg, okMsg: 'Pencere ' + deg + ' dereceye getirildi.', code: 'window:set:' + deg, score: 104 };
      }
      if (hasAjar) {
        return { type: 'device', device: 'window', action: 'ajar', value: 0, okMsg: 'Pencere aralık konuma getirildi.', code: 'window:ajar', score: 102 };
      }
      if (hasOpen) {
        return { type: 'device', device: 'window', action: 'open', value: 0, okMsg: 'Pencere tam açıldı.', code: 'window:open', score: 102 };
      }
    }

    /* 7) Panjur / perde */
    if (hasFuzzyAny(ctx, ['panjur', 'perde', 'jaluzi'])) {
      if (hasStop && !hasShutterClose) {
        return { type: 'device', device: 'blind', action: 'stop', value: 0, okMsg: 'Panjur serbest bırakıldı.', code: 'blind:stop', score: 102 };
      }
      if (hasShutterClose) {
        return { type: 'device', device: 'blind', action: 'shut', value: 0, okMsg: 'Panjur kapatıldı.', code: 'blind:shut', score: 102 };
      }
      if (numInfo.value !== null) {
        const deg = numInfo.isPercent
          ? Math.max(0, Math.min(180, Math.round(numInfo.value * 1.8)))
          : Math.max(0, Math.min(180, Math.round(numInfo.value)));
        return { type: 'device', device: 'blind', action: 'set', value: deg, okMsg: 'Panjur ' + deg + ' dereceye getirildi.', code: 'blind:set:' + deg, score: 104 };
      }
      if (hasAjar) {
        return { type: 'device', device: 'blind', action: 'set', value: 90, okMsg: 'Panjur yarı açık konuma getirildi.', code: 'blind:set:90', score: 102 };
      }
      if (hasOpen) {
        return { type: 'device', device: 'blind', action: 'open', value: 0, okMsg: 'Panjur açıldı.', code: 'blind:open', score: 102 };
      }
    }

    /* 8) Siren / hoparlör / ses (ayar/kontrol/gecmis navigasyonu değilse) */
    if (hasFuzzyAny(ctx, ['siren', 'alarm', 'hoparlor', 'ses', 'bip', 'ton']) &&
        !hasAnyToken(ctx, ['ayar', 'ayarlar', 'gecmis', 'kayit', 'esik', 'bildirim', 'anons', 'konusma', 'okuma']) &&
        !(hasPhrase(ctx, 'siren ve ses') && hasAnyToken(ctx, ['kontrol', 'git', 'gir', 'goster', 'bak'])) &&
        !(hasPhrase(ctx, 'ses kontrolu'))) {
      if (hasAnyToken(ctx, ['bip'])) {
        return { type: 'device', device: 'sound', action: 'beep', value: 0, okMsg: 'Kısa bip çalınıyor.', code: 'sound:beep', score: 103 };
      }
      if (hasTest) {
        return { type: 'device', device: 'sound', action: 'test', value: 0, okMsg: 'Test tonu çalınıyor.', code: 'sound:test', score: 102 };
      }
      if (numInfo.value !== null && hasAnyToken(ctx, ['ses', 'hoparlor', 'seviye'])) {
        const vol = Math.max(0, Math.min(100, Math.round(numInfo.value)));
        return { type: 'device', device: 'sound', action: 'set', value: vol, okMsg: 'Hoparlör sesi yüzde ' + vol + ' yapıldı.', code: 'sound:set:' + vol, score: 104 };
      }
      if (hasClose) {
        if (hasAnyToken(ctx, ['kis'])) {
          return { type: 'device', device: 'sound', action: 'set', value: 25, okMsg: 'Hoparlör sesi kısıldı.', code: 'sound:set:25', score: 102 };
        }
        return { type: 'device', device: 'sound', action: 'off', value: 0, okMsg: 'Siren susturuldu.', code: 'sound:off', score: 102 };
      }
      if (hasOpen || hasAnyToken(ctx, ['cal'])) {
        if (hasAnyToken(ctx, ['yukselt', 'fulle'])) {
          return { type: 'device', device: 'sound', action: 'set', value: 100, okMsg: 'Hoparlör sesi en yükseğe alındı.', code: 'sound:set:100', score: 102 };
        }
        return { type: 'device', device: 'sound', action: 'siren', value: 0, okMsg: 'Siren çalınıyor.', code: 'sound:siren', score: 102 };
      }
    }

    /* 9) Fan / havalandırma */
    if (hasFuzzyAny(ctx, ['fan', 'vantilator', 'havalandir', 'havalandirma', 'aspirator'])) {
      if (hasClose) return { type: 'device', device: 'fan', action: 'off', value: 0, okMsg: 'Fan durduruldu.', code: 'fan:off', score: 102 };
      if (hasOpen || hasAnyToken(ctx, ['havalandir'])) return { type: 'device', device: 'fan', action: 'on', value: 0, okMsg: 'Fan çalıştırıldı.', code: 'fan:on', score: 102 };
      if (hasToggle) return { type: 'device', device: 'fan', action: 'toggle', value: 0, okMsg: 'Fan durumu değiştirildi.', code: 'fan:toggle', score: 100 };
    }

    /* 10) Su motoru / pompa */
    if (hasFuzzyAny(ctx, ['pompa', 'motor', 'tahliye'])) {
      if (hasClose) return { type: 'device', device: 'pump', action: 'off', value: 0, okMsg: 'Su motoru durduruldu.', code: 'pump:off', score: 102 };
      if (hasOpen) return { type: 'device', device: 'pump', action: 'on', value: 0, okMsg: 'Su motoru çalıştırıldı.', code: 'pump:on', score: 102 };
      if (hasToggle) return { type: 'device', device: 'pump', action: 'toggle', value: 0, okMsg: 'Su motoru değiştirildi.', code: 'pump:toggle', score: 100 };
    }

    /* 11) Otonom koruma ("otomasyon ayarları / kuralları" navigasyonuna dokunmadan) */
    if (hasFuzzyAny(ctx, ['otomasyon', 'otomatik', 'otonom', 'koruma', 'mudahale']) &&
        !hasAnyToken(ctx, ['ayar', 'ayarlar', 'kural', 'zamanlama', 'mod'])) {
      if (hasClose) return { type: 'device', device: 'auto', action: 'off', value: 0, okMsg: 'Otonom koruma kapatıldı.', code: 'auto:off', score: 100 };
      if (hasOpen) return { type: 'device', device: 'auto', action: 'on', value: 0, okMsg: 'Otonom koruma açıldı.', code: 'auto:on', score: 100 };
      return { type: 'device', device: 'auto', action: 'toggle', value: 0, okMsg: 'Otonom koruma değiştirildi.', code: 'auto:toggle', score: 96 };
    }

    /* 12) Sarsıntı sensörü (kart/navigasyon değilse test/temizle/aç-kapa) */
    if (hasFuzzyAny(ctx, ['titresim', 'sarsinti'])) {
      if (hasClear) return { type: 'device', device: 'vibration', action: 'clear', value: 0, okMsg: 'Sarsıntı durumu temizlendi.', code: 'vib:clear', score: 103 };
      if (hasTest) return { type: 'device', device: 'vibration', action: 'test', value: 0, okMsg: 'Sarsıntı testi tetiklendi.', code: 'vib:test', score: 103 };
      if (!hasExplicitHardwareNavContext(ctx)) {
        if (hasAnyToken(ctx, ['kapat', 'kapa', 'devre', 'pasif'])) return { type: 'device', device: 'vibration', action: 'off', value: 0, okMsg: 'Sarsıntı sensörü kapatıldı.', code: 'vib:off', score: 100 };
        if (hasAnyToken(ctx, ['etkinlestir', 'aktif'])) return { type: 'device', device: 'vibration', action: 'on', value: 0, okMsg: 'Sarsıntı sensörü etkinleştirildi.', code: 'vib:on', score: 100 };
      }
    }

    /* 13) Alev sensörü */
    if (hasFuzzyAny(ctx, ['alev', 'yangin'])) {
      if (hasClear) return { type: 'device', device: 'flame', action: 'clear', value: 0, okMsg: 'Alev durumu temizlendi.', code: 'flame:clear', score: 103 };
      if (hasTest) return { type: 'device', device: 'flame', action: 'test', value: 0, okMsg: 'Alev testi tetiklendi.', code: 'flame:test', score: 103 };
      if (!hasExplicitHardwareNavContext(ctx)) {
        if (hasAnyToken(ctx, ['kapat', 'kapa', 'devre', 'pasif'])) return { type: 'device', device: 'flame', action: 'off', value: 0, okMsg: 'Alev sensörü kapatıldı.', code: 'flame:off', score: 100 };
        if (hasAnyToken(ctx, ['etkinlestir', 'aktif'])) return { type: 'device', device: 'flame', action: 'on', value: 0, okMsg: 'Alev sensörü etkinleştirildi.', code: 'flame:on', score: 100 };
      }
    }

    /* 14) Su baskını test / temizleme */
    if (hasPhrase(ctx, 'su baskini') || hasAnyToken(ctx, ['sel'])) {
      if (hasClear) return { type: 'device', device: 'flood', action: 'clear', value: 0, okMsg: 'Su baskını durumu temizlendi.', code: 'flood:clear', score: 102 };
      if (hasTest) return { type: 'device', device: 'flood', action: 'test', value: 0, okMsg: 'Su baskını testi tetiklendi.', code: 'flood:test', score: 102 };
    }

    /* 15) Genel navigasyon ve yardımcı eylemler */
    if (hasPhrase(ctx, 'geri don') || hasPhrase(ctx, 'geri git') || hasPhrase(ctx, 'onceki sayfa') ||
        (ctx.tokens.length === 1 && ctx.tokens[0] === 'geri')) {
      return { type: 'action', action: 'back', code: 'action:back', score: 98 };
    }
    if (hasPhrase(ctx, 'yukari cik') || hasPhrase(ctx, 'basa cik') || hasPhrase(ctx, 'en uste') || hasPhrase(ctx, 'en ust')) {
      return { type: 'action', action: 'scroll_top', code: 'action:scroll_top', score: 96 };
    }
    if (hasAnyToken(ctx, ['anons', 'anonsu', 'konusma', 'konusmayi', 'okuma', 'okumayi']) &&
        hasAnyToken(ctx, ['sustur', 'sus', 'durdur', 'kes', 'kapat'])) {
      return { type: 'action', action: 'mute_tts', code: 'action:mute_tts', score: 102 };
    }
    if (hasAnyToken(ctx, ['yardim', 'komutlar', 'komutlari']) || hasPhrase(ctx, 'ne diyebilirim') || hasPhrase(ctx, 'neler soyleyebilirim')) {
      return { type: 'action', action: 'help', code: 'action:help', score: 95 };
    }
    if ((hasAnyToken(ctx, ['diger', 'menuyu', 'menu', 'bolumler', 'bolumleri']) && hasAnyToken(ctx, ['ac', 'goster', 'acin'])) ||
        hasPhrase(ctx, 'diger menu') || hasPhrase(ctx, 'ek bolumler')) {
      return { type: 'action', action: 'menu', code: 'action:menu', score: 92 };
    }

    /* 16) Tüm sekmeler, sayfalar, kartlar, ayar bölümleri ve 3D odalar */
    if (navMatch) {
      const code = navMatch.dest.kind === 'room'
        ? 'room:' + navMatch.dest.id
        : (navMatch.dest.kind === 'settings' && navMatch.dest.panelId)
          ? 'nav:settings:' + navMatch.dest.panelId
          : 'nav:' + navMatch.dest.id;
      return { type: 'nav', dest: navMatch.dest, code: code, score: navMatch.score };
    }

    return { type: 'unknown', code: 'unknown', score: 0 };
  }

  /* -------------------------------------------- Ayrıştırılan komutu çalıştırma */

  function applyVoiceTheme(targetTheme) {
    let next = targetTheme;
    const cur = (App.settings && App.settings().theme) ||
      document.documentElement.getAttribute('data-theme') || 'light';
    if (next === 'toggle') {
      next = (cur === 'dark' || cur === 'amoled') ? 'light' : 'dark';
    }
    if (App.saveSettings) App.saveSettings({ theme: next });
    if (App.applyTheme) App.applyTheme(next);
    else document.documentElement.setAttribute('data-theme', next);
    const label = next === 'light' ? 'Aydınlık tema' : (next === 'amoled' ? 'AMOLED tema' : 'Karanlık tema');
    if (App.toast) App.toast(label + ' etkinleştirildi.', { kind: 'ok', duration: 2400 });
    if (App.sound && App.sound.click) App.sound.click();
    speakFeedback(label + ' açıldı.');
    return 'theme:' + next;
  }

  function applyHouse3DSky(action) {
    const night = action === 'night';
    if (App.House3D && typeof App.House3D.setNightMode === 'function') {
      App.House3D.setNightMode(night);
      const msg = night ? '3D ev gece görünümüne alındı.' : '3D ev gündüz görünümüne alındı.';
      if (App.toast) App.toast(msg, { kind: 'ok', duration: 2400 });
      if (App.sound && App.sound.click) App.sound.click();
      return 'house3d:' + action;
    }
    if (App.toast) App.toast('3D ev görünümü yalnız Panel sekmesinde kullanılabilir.', { kind: 'warn' });
    return 'house3d:unavailable';
  }

  function executeParsed(parsed, raw) {
    if (!parsed || parsed.type === 'empty') return 'empty';

    if (parsed.type === 'device') {
      if (parsed.device === 'sound' && parsed.action === 'set' && App.saveSettings) {
        App.saveSettings({ sndVolume: parsed.value });
      }
      run(parsed.device, parsed.action, parsed.value, parsed.okMsg);
      return parsed.code;
    }

    if (parsed.type === 'status') {
      reportStatus();
      return 'status';
    }

    if (parsed.type === 'theme') {
      return applyVoiceTheme(parsed.theme);
    }

    if (parsed.type === 'house3d') {
      return applyHouse3DSky(parsed.action);
    }

    if (parsed.type === 'mode') {
      if (App.Automation && typeof App.Automation.apply === 'function') {
        App.Automation.apply(parsed.mode, { source: 'voice', push: true });
        return 'mode:' + parsed.mode;
      }
      if (App.toast) App.toast('Çalışma modu yalnız cihaz bağlantılı sayfalarda değiştirilebilir.', { kind: 'warn' });
      return 'mode:unavailable';
    }

    if (parsed.type === 'nav') {
      return executeDestination(parsed.dest);
    }

    if (parsed.type === 'action') {
      if (parsed.action === 'back') {
        if (typeof window !== 'undefined' && window.history && typeof window.history.back === 'function') {
          if (App.toast) App.toast('Önceki sayfaya dönülüyor.', { kind: 'ok', duration: 1800 });
          window.history.back();
        }
        return 'action:back';
      }
      if (parsed.action === 'scroll_top') {
        if (typeof window !== 'undefined' && window.scrollTo) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        if (App.toast) App.toast('Sayfa başına çıkıldı.', { kind: 'ok', duration: 1800 });
        return 'action:scroll_top';
      }
      if (parsed.action === 'mute_tts') {
        if (App.voice && App.voice.stop) App.voice.stop();
        else if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.cancel) {
          try { window.speechSynthesis.cancel(); } catch (e) {}
        }
        if (App.toast) App.toast('Sesli okuma durduruldu.', { kind: 'ok', duration: 2000 });
        return 'action:mute_tts';
      }
      if (parsed.action === 'menu') {
        const moreBtn = $('mobileMoreBtn');
        if (currentPage() === 'settings' && App.StudioNav && App.StudioNav.open) {
          App.StudioNav.open();
        } else if (moreBtn) {
          moreBtn.click();
        }
        return 'action:menu';
      }
      if (parsed.action === 'help') {
        const helpMsg = 'Örnekler: “Sensörleri aç”, “Panel”, “Mutfağa bak”, “Ayarlara gir”, “Pencereyi kapat”, “Gece moduna geç”.';
        if (App.toast) App.toast(helpMsg, { kind: 'ok', duration: 6000 });
        speakFeedback('Sensörleri aç, Panel, Mutfağa bak veya Pencereyi kapat gibi komutlar verebilirsiniz.');
        return 'action:help';
      }
    }

    if (App.toast) App.toast('Komut anlaşılamadı: “' + raw + '”', { kind: 'warn' });
    return 'unknown';
  }

  /* ------------------------------ Çoklu Web Speech adayı çözümleme & yürütme */

  function resolveBest(alternatives) {
    const list = Array.isArray(alternatives)
      ? alternatives
      : [{ transcript: String(alternatives || ''), confidence: 1 }];

    let best = null;
    for (let i = 0; i < list.length; i++) {
      const item = typeof list[i] === 'string'
        ? { transcript: list[i], confidence: 1 }
        : (list[i] || { transcript: '', confidence: 0 });
      const text = String(item.transcript || '').trim();
      if (!text) continue;
      const parsed = parse(text);
      const conf = Number(item.confidence) || 0;
      const rank = parsed.score > 0
        ? (parsed.score * 10) + (conf * 2) - (i * 0.15)
        : 0;
      if (!best || rank > best.rank || (rank === best.rank && parsed.score > best.parsed.score)) {
        best = { transcript: text, parsed: parsed, rank: rank };
      }
    }

    if (!best) return { transcript: '', parsed: { type: 'empty', code: 'empty', score: 0 }, rank: 0 };
    return best;
  }

  function handle(input) {
    if (Array.isArray(input)) {
      const best = resolveBest(input);
      return executeParsed(best.parsed, best.transcript);
    }
    const text = String(input || '').trim();
    return executeParsed(parse(text), text);
  }

  /* ------------------------------------------------------------------ mikrofon */

  function triggerButtons() {
    return Array.prototype.slice.call(
      document.querySelectorAll('#voiceBtn, [data-voice-trigger]')
    );
  }

  function setBanner(visible, title, sub) {
    const banner = $('voiceStatusBanner');
    const titleEl = $('voiceStatusTitle');
    const subEl = $('voiceStatusSub');
    clearTimeout(bannerTimer);
    if (!banner) return;
    if (!visible) {
      banner.hidden = true;
      banner.classList.remove('is-listening', 'is-error');
      return;
    }
    if (titleEl && title !== undefined) titleEl.textContent = title;
    if (subEl && sub !== undefined) subEl.textContent = sub;
    banner.hidden = false;
    banner.classList.toggle('is-listening', listening);
  }

  function setListening(on, note, subNote) {
    listening = on;
    triggerButtons().forEach(function (btn) {
      btn.classList.toggle('listening', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (on) {
      setBanner(true, note || 'Dinleniyor…', subNote || 'Komut söyleyin — örn. “Sensörleri aç”, “Panel”, “Mutfağa bak”');
      hint(note || 'Dinleniyor… konuşun');
    } else {
      hint(note || '');
    }
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

  function attachGrammar(recognition) {
    if (!SGL || !recognition) return;
    try {
      const words = [
        'panel', 'sensörler', 'sensörleri aç', 'kontrol', 'geçmiş', 'olaylar',
        'sistem', 'deprem', 'ayarlar', 'hesap', 'profilim', 'cihazlarım',
        'mutfak', 'salon', 'yatak odası', 'bahçe', 'genel',
        'pencereyi aç', 'pencereyi kapat', 'panjuru aç', 'fanı çalıştır',
        'gece moduna geç', 'durum nedir', 'karanlık tema', 'aydınlık tema'
      ];
      const grammar = '#JSGF V1.0; grammar komutlar; public <komut> = ' + words.join(' | ') + ' ;';
      const list = new SGL();
      if (typeof list.addFromString === 'function') {
        list.addFromString(grammar, 1);
        recognition.grammars = list;
      }
    } catch (e) { /* tarayıcı gramer ipucunu yoksayabilir */ }
  }

  function start() {
    if (!SR) {
      const msg = 'Bu tarayıcı sesli komutu desteklemiyor (Chrome veya Edge önerilir).';
      if (App.toast) App.toast(msg, { kind: 'warn', duration: 4000 });
      return;
    }
    if (!recog) {
      try { initRecognition(); }
      catch (e) {
        if (App.toast) App.toast('Sesli komut başlatılamadı.', { kind: 'warn' });
        return;
      }
    }
    if (listening) return;
    cancelledByUser = false;
    setListening(true, 'Dinleniyor…', 'Komut söyleyin — örn. “Sensörleri aç”, “Panel”, “Mutfağa bak”');
    try {
      recog.start();
    } catch (e) {
      /* InvalidStateError vb. */
    }
  }

  function cancel() {
    cancelledByUser = true;
    setListening(false, '');
    setBanner(false);
    if (recog) {
      try { recog.abort(); }
      catch (e) { try { recog.stop(); } catch (e2) {} }
    }
  }

  function stop() {
    cancel();
  }

  function initRecognition() {
    recog = new SR();
    recog.lang = 'tr-TR';
    recog.continuous = false;
    recog.interimResults = true;
    recog.maxAlternatives = 5;
    attachGrammar(recog);

    recog.onstart = function () {
      if (cancelledByUser) return;
      setListening(true, 'Dinleniyor…', 'Komut söyleyin — örn. “Sensörleri aç”, “Panel”, “Mutfağa bak”');
    };

    recog.onresult = function (ev) {
      let interim = '';
      const finalAlts = [];
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) {
          for (let j = 0; j < r.length; j++) {
            if (r[j] && r[j].transcript) {
              finalAlts.push({ transcript: r[j].transcript, confidence: r[j].confidence || 0 });
            }
          }
        } else if (r[0] && r[0].transcript) {
          interim += r[0].transcript;
        }
      }
      if (interim) {
        const clean = '“' + interim.trim() + '…”';
        hint(clean);
        setBanner(true, 'Dinleniyor…', clean);
      }
      if (finalAlts.length) {
        const chosen = resolveBest(finalAlts);
        const text = chosen.transcript || finalAlts[0].transcript.trim();
        hint('“' + text + '”');
        setListening(false, '“' + text + '”');
        setBanner(true, 'Komut algılandı', '“' + text + '”');
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(function () { setBanner(false); }, 2200);
        executeParsed(chosen.parsed, text);
      }
    };

    recog.onerror = function (ev) {
      const code = ev && ev.error;
      if (cancelledByUser || code === 'aborted') {
        setListening(false, '');
        setBanner(false);
        return;
      }
      const msg = code === 'not-allowed' || code === 'service-not-allowed'
        ? 'Mikrofon izni reddedildi.'
        : code === 'no-speech' ? 'Ses algılanamadı, tekrar deneyin.'
        : code === 'audio-capture' ? 'Mikrofon bulunamadı.'
        : 'Ses tanıma hatası (' + code + ').';
      setListening(false, msg);
      setBanner(true, 'Dinleme durduruldu', msg);
      const b = $('voiceStatusBanner');
      if (b) b.classList.add('is-error');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(function () { setBanner(false); }, 3200);
      if (App.toast) App.toast(msg, { kind: 'warn' });
    };

    recog.onend = function () {
      if (listening) {
        setListening(false);
        if (cancelledByUser) {
          setBanner(false);
        } else {
          clearTimeout(bannerTimer);
          bannerTimer = setTimeout(function () { setBanner(false); }, 1800);
        }
      }
    };
  }

  function toggle() {
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.cancel) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    if (listening) cancel();
    else start();
  }

  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', function (e) {
      const cancelBtn = e.target && e.target.closest ? e.target.closest('#voiceCancelBtn') : null;
      if (cancelBtn) {
        e.preventDefault();
        cancel();
        return;
      }
      const btn = e.target && e.target.closest ? e.target.closest('#voiceBtn, [data-voice-trigger]') : null;
      if (!btn) return;
      e.preventDefault();
      toggle();
    });
    document.addEventListener('keydown', function (e) {
      if (listening && (e.key === 'Escape' || e.keyCode === 27)) {
        cancel();
      }
    });
  }

  function init() {
    const btns = triggerButtons();
    if (!btns.length) {
      bind();
      return;
    }
    if (!SR) {
      btns.forEach(function (btn) {
        btn.setAttribute('aria-disabled', 'true');
        btn.title = 'Bu tarayıcı sesli komutu desteklemiyor (Chrome önerilir)';
      });
    } else {
      try { initRecognition(); } catch (e) { /* tıklamada tekrar dener */ }
    }
    bind();
  }

  App.Speech = {
    init: init,
    handle: handle,
    parse: parse,
    resolveBest: resolveBest,
    destinations: function () { return DESTINATIONS.slice(); },
    start: start,
    stop: stop,
    cancel: cancel,
    toggle: toggle,
    available: function () { return !!SR; },
    _setNavigator: function (nav) { customNavigator = nav || null; }
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
