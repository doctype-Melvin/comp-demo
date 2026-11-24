// app.js — UI wiring for the Complyable browser demo.
import { parseFile } from "./parse.js";
import { detect } from "./tiers.js";

// pdf.js worker (same-origin, vendored)
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
}

const PAGE_LIMIT = 5;

const $ = (id) => document.getElementById(id);
const el = {
  dropzone: $("dropzone"), fileInput: $("fileInput"), browseBtn: $("browseBtn"),
  sampleBtn: $("sampleBtn"), banner: $("banner"), workspace: $("workspace"),
  fileName: $("fileName"), docMeta: $("docMeta"), doc: $("doc"),
  statTotal: $("statTotal"), statRedact: $("statRedact"),
  statExclude: $("statExclude"), statGender: $("statGender"),
  redactAll: $("redactAll"), excludeAll: $("excludeAll"),
  downloadBtn: $("downloadBtn"), copyBtn: $("copyBtn"), resetBtn: $("resetBtn"),
  findingList: $("findingList"),
};

const state = { text: "", findings: [], fileName: "", kind: "" };

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function banner(msg, type = "info") {
  el.banner.textContent = msg;
  el.banner.className = "banner " + type;
  el.banner.hidden = false;
}
function clearBanner() { el.banner.hidden = true; }

// ── Loading ────────────────────────────────────────────────────────────────
async function handleFile(file) {
  clearBanner();
  if (!file) return;
  try {
    const parsed = await parseFile(file);
    if (parsed.pages > PAGE_LIMIT) {
      banner(`Dieses Dokument hat ${parsed.pages} Seiten. Die Demo verarbeitet maximal ${PAGE_LIMIT} Seiten.`, "error");
      return;
    }
    if (!parsed.text || parsed.text.length < 5) {
      banner("Kein Text erkannt. Bei gescannten PDFs ist derzeit kein Textlayer vorhanden.", "error");
      return;
    }
    loadDocument(parsed.text, file.name, `${parsed.kind.toUpperCase()} · ${parsed.pages} Seite(n)`);
  } catch (err) {
    console.error(err);
    banner("Datei konnte nicht gelesen werden: " + err.message, "error");
  }
}

function loadDocument(text, fileName, meta) {
  state.text = text;
  state.fileName = fileName;
  state.findings = detect(text);
  el.fileName.textContent = fileName;
  el.docMeta.textContent = meta;
  el.workspace.hidden = false;
  el.dropzone.hidden = true;
  if (state.findings.length === 0) {
    banner("Keine sensiblen Daten erkannt — die Datei sieht sauber aus.", "info");
  }
  render();
  el.workspace.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Rendering ──────────────────────────────────────────────────────────────
function render() {
  renderDoc();
  renderStats();
  renderList();
}

function renderDoc() {
  const text = state.text;
  let html = "";
  let cursor = 0;
  for (const f of state.findings) {
    if (f.start > cursor) html += esc(text.slice(cursor, f.start));
    const cls = f.status === "exclude" ? "excluded" : (f.category === "GENDER" ? "gender" : "pii");
    const tip = f.suggestion ? `${f.label} → ${f.suggestion}` : f.label;
    html += `<mark class="${cls}" data-id="${f.id}" title="${esc(tip)}">${esc(text.slice(f.start, f.end))}</mark>`;
    cursor = f.end;
  }
  html += esc(text.slice(cursor));
  el.doc.innerHTML = html;
}

function renderStats() {
  const total = state.findings.length;
  const exclude = state.findings.filter((f) => f.status === "exclude").length;
  const gender = state.findings.filter((f) => f.category === "GENDER").length;
  el.statTotal.textContent = total;
  el.statRedact.textContent = total - exclude;
  el.statExclude.textContent = exclude;
  el.statGender.textContent = gender;
}

function renderList() {
  const groups = new Map();
  for (const f of state.findings) {
    const key = f.text.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { text: f.text, label: f.label, category: f.category, suggestion: f.suggestion, items: [] });
    }
    groups.get(key).items.push(f);
  }

  if (groups.size === 0) {
    el.findingList.innerHTML = '<li class="empty">Keine Funde.</li>';
    return;
  }

  el.findingList.innerHTML = "";
  for (const g of groups.values()) {
    const allExcluded = g.items.every((f) => f.status === "exclude");
    const li = document.createElement("li");
    if (allExcluded) li.classList.add("is-excluded");

    const left = document.createElement("div");
    const sub = g.category === "GENDER" && g.suggestion ? ` → ${g.suggestion}` : ` · ${g.label}`;
    left.innerHTML = `<span class="f-text">${esc(g.text)}</span><span class="f-sub">${esc(sub)} (${g.items.length})</span>`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = allExcluded ? "redigieren" : "ausnehmen";
    btn.addEventListener("click", () => {
      const target = allExcluded ? "redact" : "exclude";
      g.items.forEach((f) => { f.status = target; });
      render();
    });

    li.appendChild(left);
    li.appendChild(btn);
    el.findingList.appendChild(li);
  }
}

// ── Interactions ───────────────────────────────────────────────────────────
el.doc.addEventListener("click", (e) => {
  const mark = e.target.closest("mark[data-id]");
  if (!mark) return;
  const f = state.findings[Number(mark.dataset.id)];
  if (!f) return;
  f.status = f.status === "exclude" ? "redact" : "exclude";
  render();
});

function setAll(status) {
  state.findings.forEach((f) => { f.status = status; });
  render();
}
el.redactAll.addEventListener("click", () => setAll("redact"));
el.excludeAll.addEventListener("click", () => setAll("exclude"));

function redactedText() {
  let out = "";
  let cursor = 0;
  for (const f of state.findings) {
    out += state.text.slice(cursor, f.start);
    if (f.status === "redact") {
      out += f.category === "GENDER" && f.suggestion ? f.suggestion : `[${f.label}]`;
    } else {
      out += state.text.slice(f.start, f.end);
    }
    cursor = f.end;
  }
  out += state.text.slice(cursor);
  return out;
}

el.downloadBtn.addEventListener("click", () => {
  const blob = new Blob([redactedText()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (state.fileName.replace(/\.[^.]+$/, "") || "dokument") + ".redigiert.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

el.copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(redactedText());
    banner("Redigierter Text in die Zwischenablage kopiert.", "info");
  } catch {
    banner("Kopieren nicht möglich — bitte die Datei herunterladen.", "error");
  }
});

el.resetBtn.addEventListener("click", () => {
  state.text = ""; state.findings = []; state.fileName = "";
  el.workspace.hidden = true;
  el.dropzone.hidden = false;
  el.fileInput.value = "";
  clearBanner();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ── Dropzone wiring ────────────────────────────────────────────────────────
el.browseBtn.addEventListener("click", (e) => { e.stopPropagation(); el.fileInput.click(); });
el.fileInput.addEventListener("change", () => handleFile(el.fileInput.files[0]));

el.dropzone.addEventListener("click", (e) => {
  if (e.target.closest("button")) return; // don't hijack the buttons
  el.fileInput.click();
});
el.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.fileInput.click(); }
});
["dragenter", "dragover"].forEach((ev) =>
  el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.add("dragover"); })
);
["dragleave", "dragend"].forEach((ev) =>
  el.dropzone.addEventListener(ev, () => el.dropzone.classList.remove("dragover"))
);
el.dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  el.dropzone.classList.remove("dragover");
  handleFile(e.dataTransfer.files[0]);
});

// ── Sample document ────────────────────────────────────────────────────────
const SAMPLE = `Lebenslauf

Max Mustermann
Musterstraße 12
20095 Hamburg
Telefon: +49 40 1234567
E-Mail: max.mustermann@example.com
LinkedIn: @maxmustermann

Berufserfahrung
2019 – 2023   Kaufmann für Büromanagement, Beispiel GmbH, Hamburg
2023 – 2025   Erzieher im Kindergarten Sonnenschein
Praktikum als Lehrerin an der Grundschule Altona

Ausbildung
2015 – 2019   Studium der Betriebswirtschaftslehre
Abschluss: Bachelor of Arts

Kenntnisse
SAP, Excel, Projektmanagement
Sprachen: Deutsch (Muttersprache), Englisch (C1)

Hamburg, 12.03.2025`;

el.sampleBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  clearBanner();
  loadDocument(SAMPLE, "Beispiel-Lebenslauf.txt", "BEISPIEL · 1 Seite");
});