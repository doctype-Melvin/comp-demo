// parse.js — extract text + page count from a dropped file, in the browser.

function normalize(text) {
  return (text || "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    // Drop private-use glyphs (icon-font bullets in some PDFs render as tofu)
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Reconstruct lines from pdf.js text items by grouping on the y coordinate.
function itemsToText(items) {
  const rows = new Map();
  for (const it of items) {
    if (!it.str || !it.transform) continue;
    const y = Math.round(it.transform[5] / 2) * 2; // bucket to reduce jitter
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(it);
  }
  const ys = [...rows.keys()].sort((a, b) => b - a); // top → bottom
  return ys
    .map((y) => {
      const its = rows.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
      return its.map((i) => i.str).join(" ").replace(/[ \t]+/g, " ").trim();
    })
    .filter(Boolean)
    .join("\n");
}

async function parsePdf(file) {
  const data = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data }).promise;
  const pages = pdf.numPages;
  const chunks = [];
  const limit = Math.min(pages, 5); // only read the first 5 pages
  for (let p = 1; p <= limit; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    chunks.push(itemsToText(content.items));
  }
  return { text: normalize(chunks.join("\n\n")), pages, kind: "pdf" };
}

async function parseDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  const text = normalize(result.value);
  const words = text.split(/\s+/).filter(Boolean).length;
  const pages = Math.max(1, Math.ceil(words / 500)); // rough estimate
  return { text, pages, kind: "docx" };
}

async function parseTxt(file) {
  const text = normalize(await file.text());
  const words = text.split(/\s+/).filter(Boolean).length;
  const pages = Math.max(1, Math.ceil(words / 500));
  return { text, pages, kind: "txt" };
}

export async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return parsePdf(file);
  if (name.endsWith(".docx")) return parseDocx(file);
  if (name.endsWith(".txt")) return parseTxt(file);
  throw new Error("Nicht unterstütztes Format. Bitte PDF, DOCX oder TXT verwenden.");
}