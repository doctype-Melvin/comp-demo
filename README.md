# Complyable — Web Demo (client-side)

A fully **client-side** showcase of Complyable. Drop a CV (PDF/DOCX/TXT, max 5
pages) and it detects PII + gendered job titles **entirely in the browser** —
nothing is uploaded, nothing is stored. Hosts for **$0** on any static host.

## What works (Phase 0)

- **Tier 1 — Regex:** e-mail, phone, web links, social handles, postal codes,
  addresses, dates. Unicode-aware word boundaries (umlauts work).
- **Tier 2 (stand-in) — Names:** header-name heuristic, all-caps name blocks
  (e.g. `LENA` / `SCHMIDT` in multi-column DOCX), and salutations
  (`Frau Müller`, `Herrn Max Mustermann`).
- **Tier 3 — Gender:** 154-entry neutralization dictionary + `Kaufmann/Kauffrau`
  compound rules, with suggested replacements (`Bürokaufmann → Bürofachkraft`).
- **Review UI:** click any highlight to toggle redact/exclude; per-term toggles;
  live counts.
- **Output:** download or copy the redacted text.
- **Gate:** rejects files over 5 pages with a clear message.
- **Formats:** PDF text layer (pdf.js), DOCX (mammoth), plain TXT. Scanned PDFs
  without a text layer are reported as unsupported.

Planned: a real in-browser NER model (Tier 2) via `transformers.js` in a Web
Worker, and PDF certificate output.

There is a test file at `samples/sample-cv.pdf` (2 pages) if you want to try the
PDF path quickly.

## Verified

- PDF (2 pages) → 15 findings, `Bürokaufmann → Bürofachkraft`
- DOCX (multi-column) → names `LENA` / `SCHMIDT` detected, 14 findings
- TXT → 6 findings incl. `Ärztin → Medizinische Fachkraft`
- 6-page PDF → rejected by the 5-page gate
- Download → correct `.redigiert.txt`
- Lighthouse: Accessibility 100 · Best Practices 100 · SEO 100

## Run locally

No build step, no dependencies to install:

```bash
cd complyable-web
python3 -m http.server 8080
# open http://localhost:8080
```

(Any static file server works. Opening `index.html` directly via `file://` will
not work because ES modules and the PDF worker require `http(s)://`.)

## Publish to GitHub

Create a **new empty repository** on GitHub (no README, no `.gitignore`), then:

```bash
cd complyable-web
git remote add origin https://github.com/<your-user>/<repo>.git
git push -u origin main
```

This folder is already a git repository with the full commit history, so there
is nothing else to initialize.

## Deploy for free

The folder is plain static files. Any of these work at no cost:

- **Cloudflare Pages** — connect the repo, set the root directory to the repo
  root, no build command.
- **GitHub Pages** — *Settings → Pages → Deploy from a branch*, `main` / `/root`.
- **Netlify / Vercel** — drag-and-drop the folder (static).

## Structure

```
complyable-web/
├── index.html          # layout
├── styles.css          # styling
├── src/
│   ├── app.js          # UI wiring, review, redaction output
│   ├── parse.js        # PDF (pdf.js) / DOCX (mammoth) / TXT extraction
│   ├── tiers.js        # Tier 1 regex + Tier 3 gender + name heuristics
│   └── dict.js         # generated from dict_seed.csv (154 entries)
├── samples/
│   └── sample-cv.pdf   # 2-page test CV
└── vendor/             # pdf.js + mammoth, vendored (no CDN at runtime)
```

## Regenerating the dictionary

```bash
python3 - <<'PY'
import csv, json
rows=[r for r in csv.DictReader(open("../complyable-code/data/refs/dict_seed.csv", encoding="utf-8"))
      if (r.get("original") or "").strip() and (r.get("neutral") or "").strip()]
out="// Auto-generated from dict_seed.csv — do not edit by hand.\n"
out+="export const NEUTRALIZER = "+json.dumps(
    [{"original":r["original"].strip(),"neutral":r["neutral"].strip(),"category":(r.get("category") or "").strip()} for r in rows],
    ensure_ascii=False, indent=0)+";\n"
open("src/dict.js","w",encoding="utf-8").write(out)
PY
```

## Notes

- **Privacy:** everything runs locally; there is no backend and no network call
  at runtime (the parser libraries are vendored).
- **Limits:** 5 pages max; DOCX/TXT page counts are estimated from word count.
- Name detection is heuristic (header, all-caps blocks, salutations) and less
  complete than the desktop app's spaCy `de_core_news_md` NER. A browser NER
  model is the planned Phase 1 upgrade; Tier 1 + Tier 3 already carry most of
  the detection.
