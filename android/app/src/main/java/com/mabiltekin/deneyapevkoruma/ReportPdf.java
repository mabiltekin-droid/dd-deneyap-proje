package com.mabiltekin.deneyapevkoruma;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Olay günlüğünü A4 PDF'e çizer ve Android paylaşım sayfasını açar.
 *
 * <p>PDF'i tarayıcıda değil burada üretiyoruz: Türkçe karakterler sistem
 * yazı tipiyle sorunsuz çıkar, harici kütüphane gerekmez ve dosya doğrudan
 * e-posta/WhatsApp ile paylaşılabilir.</p>
 */
public final class ReportPdf {

    private static final int PAGE_W = 595;   // A4 @72dpi
    private static final int PAGE_H = 842;
    private static final int MARGIN = 36;

    private static final int C_BG = Color.WHITE;
    private static final int C_INK = Color.parseColor("#0F172A");
    private static final int C_MUTED = Color.parseColor("#64748B");
    private static final int C_LINE = Color.parseColor("#E2E8F0");
    private static final int C_HEAD = Color.parseColor("#0A0D14");
    private static final int C_ACCENT = Color.parseColor("#0EA5E9");

    private ReportPdf() {
    }

    public static void share(final Activity activity, final String json) {
        try {
            File file = build(activity, json);
            Uri uri = FileProvider.getUriForFile(
                    activity, activity.getPackageName() + ".files", file);

            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/pdf");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, "Deneyap Ev Koruma — Olay Raporu");
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            activity.startActivity(Intent.createChooser(send, "Raporu paylaş"));
        } catch (Throwable t) {
            Toast.makeText(activity,
                    "PDF oluşturulamadı: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private static File build(Activity activity, String json) throws Exception {
        JSONObject root = new JSONObject(json == null ? "{}" : json);

        String title = opt(root, "title", "Deneyap Ev Koruma — Olay Raporu");
        String range = opt(root, "range", "");
        String generated = opt(root, "generated", now());
        JSONArray summary = root.optJSONArray("summary");
        JSONArray rows = root.optJSONArray("rows");

        PdfDocument doc = new PdfDocument();
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        Page page = new Page(doc, paint);
        page.start();

        page.header(title, range, generated);

        if (summary != null && summary.length() > 0) {
            page.summary(summary);
        }

        page.tableHeader();
        if (rows == null || rows.length() == 0) {
            page.empty();
        } else {
            for (int i = 0; i < rows.length(); i++) {
                JSONObject r = rows.optJSONObject(i);
                if (r == null) continue;
                page.row(
                        opt(r, "time", ""),
                        opt(r, "device", ""),
                        opt(r, "type", ""),
                        opt(r, "severity", ""),
                        opt(r, "message", ""));
            }
        }
        page.finish();

        File dir = new File(activity.getCacheDir(), "reports");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("rapor klasörü açılamadı");
        }
        String stamp = new SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(new Date());
        File out = new File(dir, "deneyap-olay-raporu-" + stamp + ".pdf");

        try (FileOutputStream fos = new FileOutputStream(out)) {
            doc.writeTo(fos);
        } finally {
            doc.close();
        }
        return out;
    }

    /* ------------------------------------------------------------------ */

    private static final class Page {
        private final PdfDocument doc;
        private final Paint p;
        private int pageNo = 0;
        private PdfDocument.Page current;
        private Canvas canvas;
        private float y;

        Page(PdfDocument doc, Paint p) {
            this.doc = doc;
            this.p = p;
            p.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL));
        }

        void start() {
            newPage();
        }

        private void newPage() {
            if (current != null) {
                footer();
                doc.finishPage(current);
            }
            pageNo++;
            PdfDocument.PageInfo info = new PdfDocument.PageInfo.Builder(
                    PAGE_W, PAGE_H, pageNo).create();
            current = doc.startPage(info);
            canvas = current.getCanvas();
            canvas.drawColor(C_BG);
            y = MARGIN;
        }

        void header(String title, String range, String generated) {
            p.setStyle(Paint.Style.FILL);
            p.setColor(C_HEAD);
            canvas.drawRect(0, 0, PAGE_W, 96, p);

            p.setColor(Color.WHITE);
            p.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
            p.setTextSize(19);
            canvas.drawText(clip(title, 210, p), MARGIN, 40, p);

            p.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL));
            p.setTextSize(10);
            p.setColor(Color.parseColor("#94A3B8"));
            canvas.drawText("DENEYAP EV KORUMA  ·  OLAY RAPORU", MARGIN, 60, p);

            p.setColor(Color.parseColor("#E2E8F0"));
            p.setTextSize(10);
            if (range != null && !range.isEmpty()) {
                canvas.drawText(clip("Aralık: " + range, 250, p), MARGIN, 79, p);
            }
            canvas.drawText(clip("Oluşturma: " + generated, 250, p), PAGE_W - MARGIN - 170, 79, p);

            y = 118;
        }

        void summary(JSONArray summary) {
            p.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
            p.setTextSize(10);
            p.setColor(C_MUTED);
            canvas.drawText("ÖZET", MARGIN, y, p);
            y += 8;

            int n = Math.min(summary.length(), 4);
            float gap = 8;
            float boxW = (PAGE_W - 2 * MARGIN - gap * (n - 1)) / n;
            float boxH = 48;
            float top = y;

            for (int i = 0; i < n; i++) {
                JSONObject item = summary.optJSONObject(i);
                if (item == null) continue;
                float x = MARGIN + i * (boxW + gap);

                p.setColor(Color.parseColor("#F1F5F9"));
                canvas.drawRoundRect(x, top, x + boxW, top + boxH, 6, 6, p);

                p.setColor(C_MUTED);
                p.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL));
                p.setTextSize(8);
                canvas.drawText(clip(opt(item, "label", ""), boxW - 14, p), x + 8, top + 16, p);

                p.setColor(C_INK);
                p.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
                p.setTextSize(15);
                canvas.drawText(clip(opt(item, "value", ""), boxW - 14, p), x + 8, top + 36, p);
            }
            y = top + boxH + 22;
        }

        void tableHeader() {
            ensure(24);
            p.setColor(Color.parseColor("#E2E8F0"));
            canvas.drawRect(MARGIN, y - 12, PAGE_W - MARGIN, y + 6, p);

            p.setColor(C_MUTED);
            p.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
            p.setTextSize(8);

            float[] col = columns();
            String[] head = {"ZAMAN", "CİHAZ", "TÜR", "ÖNEM", "MESAJ"};
            for (int i = 0; i < head.length; i++) {
                canvas.drawText(head[i], col[i], y, p);
            }
            y += 18;
            p.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL));
            p.setTextSize(8.5f);
        }

        void row(String time, String device, String type, String severity, String message) {
            float[] col = columns();
            List<String> lines = wrap(message, col[4] - 4, PAGE_W - MARGIN - col[4]);

            float h = Math.max(18, lines.size() * 11 + 7);
            if (y + h > PAGE_H - 48) {
                newPage();
                header("Deneyap Ev Koruma — Olay Raporu (devam)", "", now());
                tableHeader();
            }

            if (severity != null && (severity.equalsIgnoreCase("Kritik")
                    || severity.toLowerCase(Locale.ROOT).contains("krit"))) {
                p.setColor(Color.parseColor("#FEF2F2"));
                canvas.drawRect(MARGIN, y - 10, PAGE_W - MARGIN, y - 10 + h, p);
            }

            p.setColor(C_INK);
            canvas.drawText(clip(time, col[1] - col[0] - 4, p), col[0], y, p);
            canvas.drawText(clip(device, col[2] - col[1] - 4, p), col[1], y, p);
            canvas.drawText(clip(type, col[3] - col[2] - 4, p), col[2], y, p);

            p.setColor(severity != null && severity.toLowerCase(Locale.ROOT).contains("krit")
                    ? Color.parseColor("#DC2626") : C_MUTED);
            canvas.drawText(clip(severity, col[4] - col[3] - 4, p), col[3], y, p);

            p.setColor(C_INK);
            for (int i = 0; i < lines.size(); i++) {
                canvas.drawText(lines.get(i), col[4], y + i * 11, p);
            }

            y += h;
            p.setColor(C_LINE);
            canvas.drawLine(MARGIN, y - 7, PAGE_W - MARGIN, y - 7, p);
        }

        void empty() {
            p.setColor(C_MUTED);
            p.setTextSize(10);
            canvas.drawText("Seçilen aralıkta olay kaydı yok.", MARGIN, y + 12, p);
            y += 30;
        }

        void finish() {
            footer();
            doc.finishPage(current);
            current = null;
        }

        private void footer() {
            if (canvas == null) return;
            p.setColor(C_LINE);
            canvas.drawLine(MARGIN, PAGE_H - 36, PAGE_W - MARGIN, PAGE_H - 36, p);

            p.setColor(C_MUTED);
            p.setTextSize(8);
            p.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL));
            canvas.drawText("Deneyap Ev Koruma · ddproje.vercel.app", MARGIN, PAGE_H - 22, p);

            String num = "Sayfa " + pageNo;
            canvas.drawText(num, PAGE_W - MARGIN - p.measureText(num), PAGE_H - 22, p);
        }

        private void ensure(float need) {
            if (y + need > PAGE_H - 48) {
                newPage();
            }
        }

        private float[] columns() {
            return new float[]{
                    MARGIN,
                    MARGIN + 96,
                    MARGIN + 170,
                    MARGIN + 246,
                    MARGIN + 300
            };
        }

        private List<String> wrap(String text, float firstWidth, float width) {
            List<String> out = new ArrayList<>();
            if (text == null) text = "";
            String[] words = text.replace('\n', ' ').split(" ");
            StringBuilder line = new StringBuilder();
            float limit = firstWidth;
            for (String w : words) {
                String candidate = line.length() == 0 ? w : line + " " + w;
                if (p.measureText(candidate) > limit && line.length() > 0) {
                    out.add(line.toString());
                    line = new StringBuilder(w);
                    limit = width;
                } else {
                    line = new StringBuilder(candidate);
                }
            }
            out.add(line.toString());
            return out;
        }

        private String clip(String text, float width, Paint paint) {
            if (text == null) return "";
            if (paint.measureText(text) <= width) return text;
            String ell = "…";
            int lo = 0;
            int hi = text.length();
            while (lo < hi) {
                int mid = (lo + hi + 1) / 2;
                if (paint.measureText(text.substring(0, mid) + ell) <= width) lo = mid;
                else hi = mid - 1;
            }
            return text.substring(0, Math.max(0, lo)) + ell;
        }
    }

    private static String opt(JSONObject o, String key, String fallback) {
        if (o == null) return fallback;
        String v = o.optString(key, fallback);
        return v == null ? fallback : v;
    }

    private static String now() {
        return new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault()).format(new Date());
    }
}
