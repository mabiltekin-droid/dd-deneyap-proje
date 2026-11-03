# Arayüz yönü: Sakin Ev

Deneyap Ev Koruma artık karanlık bir "siber görev kontrol merkezi" gibi değil,
gerçek bir evin sakin güvenlik paneli gibi görünür. Amaç, cihazın teknik
yeteneğini saklamak değil; teknik dili kullanıcının günlük diline çevirmek.

## Referans alınan açık kaynak projeler

| Proje | Lisans | Alınan ilke |
| --- | --- | --- |
| [tabler/tabler](https://github.com/tabler/tabler) | MIT | Kart, boşluk ve masaüstü ızgara disiplini |
| [home-assistant/frontend](https://github.com/home-assistant/frontend) | Apache-2.0 | Durum kartı hiyerarşisi, sıcak ve sakin renk kullanımı |
| [tremorlabs/tremor](https://github.com/tremorlabs/tremor) | Apache-2.0 | Metrik kartlarında okunaklı sayı ve etiket düzeni |
| [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | ISC | Mevcut ince çizgi ikon dili |
| [google/fonts](https://github.com/google/fonts) | OFL | DM Sans ve Fraunces yazı tipleri |

Kod kopyalanmadı. Yalnızca yerleşim, boşluk, tipografi ve durum anlatımı
ilkeleri referans alındı; uygulamanın kendi CSS'i ve mevcut HTML/JS yapısı
korundu.

## Görsel kararlar

- **Renk:** krem zemin, koyu orman yeşili birincil renk, terracotta vurgu.
  Karanlık tema da siyah-neon değil, koyu orman yeşili.
- **Tipografi:** DM Sans arayüz metinleri, Fraunces yalnızca büyük başlıklarda.
  Eski arayüzdeki her yere yayılan monospace kullanımı kaldırıldı; sayılar
  `font-variant-numeric: tabular-nums` ile hizalanıyor.
- **Hero:** ortalanmış neon başlık yerine iki sütunlu, solda açıklama sağda
  canlı ev durumu kartı.
- **Süsler:** parallax ızgara, nebula, şematik ev, tarama çizgileri, neon
  gölgeler ve DSP/SNR osiloskopları kaldırıldı. Kalan hareketler yalnızca
  durum değişimini anlatıyor.
- **Dil:** "SCADA", "DSP", "SNR", "aktüatör", "tehdit hattı" gibi terimler
  kullanıcıya görünen metinlerden çıkarıldı.

## Dosyalar

- `pwa/css/redesign.css`: Yeni görsel katman. `style.css` ve
  `mobile-app.css`'ten sonra yüklenir.
- `pwa/fonts/`: Kendi barındırılan DM Sans/Fraunces WOFF2 dosyaları.
- `pwa/index.html`, `pwa/settings.html`: Başlık, gezinme ve metinler.
- `pwa/js/config.js`, `pwa/js/theme-boot.js`: Varsayılan tema artık açık.
- `pwa/manifest.json`: PWA renkleri ve açıklaması.
- `pwa/sw.js`: Yeni CSS ve fontlar önbellek listesinde.
