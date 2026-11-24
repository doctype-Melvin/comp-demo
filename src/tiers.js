// tiers.js — client-side port of Complyable's detection tiers.
// Tier 1: deterministic regex (ported from ui/pipeline.py)
// Tier 3: gender neutralization via dictionary + compound "Kaufmann" rules
// Tier 2 (spaCy NER) is approximated here by a conservative CV-header name
// heuristic; a real browser NER model is planned for Phase 1.

import { NEUTRALIZER } from "./dict.js";

const PII = "PII";
const GENDER = "GENDER";

// ── Tier 1: regex rules (labels mirror the Python pipeline) ─────────────────
export const TIER1_RULES = [
  { label: "E-MAIL", flags: "g",
    source: String.raw`[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+` },
  { label: "DATUM", flags: "g",
    source: String.raw`\b\d{1,2}\.\d{1,2}\.(\d{4}|\d{2})\b` },
  { label: "DATUM", flags: "gi",
    source: String.raw`\b\d{1,2}\.\s(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s\d{4}\b` },
  { label: "DATUM", flags: "gi",
    source: String.raw`\b\d{2}\.\s(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s\d{4}\b` },
  { label: "DATUM", flags: "gi",
    source: String.raw`\b\d{1,2}\.\s(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s'\d{2}\b` },
  { label: "PLZ", flags: "g",
    source: String.raw`\b\d{5}\b` },
  { label: "ADRESSE", flags: "gi",
    source: String.raw`\b[A-ZÄÖÜ][a-zäöüß]+(?:straße|str\.|weg|platz|allee|gasse|damm)\s+\d+[a-zA-Z]?\b` },
  { label: "TELEFON", flags: "g",
    source: String.raw`(?:(?:\+?49[ \-\.\(\)]?)?(?:(?:\(?0\d{1,5}\)?)|(?:\d{1,5}))[ \-\.\(\)]?(?:\d[ \-\.\(\)]?){5,10}\d)` },
  { label: "WEB_LINK", flags: "g",
    source: String.raw`\b(?<!mailto:)(?<!@)(?:https?:\/\/)?(?:www\.)?(?!\d)([a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"'@]*|(?!\S))?\b(?![\w@./])` },
  { label: "SOCIAL_MEDIA", flags: "g",
    source: String.raw`@[A-Za-z0-9](?:[A-Za-z0-9._-]{1,28}[A-Za-z0-9])?` },
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Unicode-aware word-boundary match. JS \b/\w are ASCII-only, so a term like
// "Bürokaufmann" or "Ärztin" would break; use explicit \p{L} lookarounds.
function wordBoundaryRegex(term, flags = "gi") {
  const f = flags.includes("u") ? flags : flags + "u";
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`,
    f
  );
}

function makeFinding({ start, end, text, label, tier, category, confidence, suggestion = null }) {
  return {
    start, end, text, label, tier, category,
    confidence,
    suggestion,
    status: "redact",
  };
}

// ── Tier 1 runner ──────────────────────────────────────────────────────────
export function runTier1(text) {
  const findings = [];
  for (const rule of TIER1_RULES) {
    const re = new RegExp(rule.source, rule.flags.includes("g") ? rule.flags : rule.flags + "g");
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      findings.push(makeFinding({
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        label: rule.label,
        tier: 1,
        category: PII,
        confidence: 1.0,
      }));
    }
  }
  return findings;
}

// ── Tier 3: gender neutralization ──────────────────────────────────────────
// Pre-sort the dictionary longest-first so compounds win over their base word.
const DICT_SORTED = [...NEUTRALIZER].sort((a, b) => b.original.length - a.original.length);
const DICT_ORIGINALS = new Set(NEUTRALIZER.map((e) => e.original.toLowerCase()));

const KAUF_PATTERNS = [
  { source: String.raw`(?<![\p{L}\p{N}_])([\p{L}\p{N}_]+?)(kaufmann|kauffrau)(?![\p{L}])`, flags: "giu", repl: "$1fachkraft" },
  { source: String.raw`(?<![\p{L}\p{N}_])(Kaufmann|Kauffrau)\s+für(?![\p{L}])`, flags: "giu", repl: "kfm. Fachkraft für" },
  { source: String.raw`(?<![\p{L}\p{N}_])(Kaufmann|Kauffrau)(?![\p{L}])`, flags: "giu", repl: "kfm. Fachkraft" },
];

function overlapsAny(start, end, taken) {
  for (const [s, e] of taken) {
    if (start < e && end > s) return true;
  }
  return false;
}

export function runTier3(text) {
  const findings = [];
  const taken = [];

  // Dictionary lookups
  for (const entry of DICT_SORTED) {
    const re = wordBoundaryRegex(entry.original, "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      const s = m.index, e = s + m[0].length;
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (overlapsAny(s, e, taken)) continue;
      taken.push([s, e]);
      findings.push(makeFinding({
        start: s, end: e, text: m[0], label: "GEN-RE", tier: 3,
        category: GENDER, confidence: 0.9, suggestion: entry.neutral,
      }));
    }
  }

  // Compound "Kaufmann/Kauffrau" rules
  for (const { source, flags, repl } of KAUF_PATTERNS) {
    const rx = new RegExp(source, flags);
    let m;
    while ((m = rx.exec(text)) !== null) {
      const s = m.index, e = s + m[0].length;
      if (m[0].length === 0) { rx.lastIndex++; continue; }
      if (overlapsAny(s, e, taken)) continue;
      taken.push([s, e]);
      findings.push(makeFinding({
        start: s, end: e, text: m[0], label: "GEN-RE", tier: 3,
        category: GENDER, confidence: 0.85,
        suggestion: m[0].replace(new RegExp(source, "iu"), repl).trim(),
      }));
    }
  }

  return findings;
}

// ── Tier 2 stand-in: CV header name heuristic ───────────────────────────────
// Conservatively detects a person's name in the first few lines of a CV,
// e.g. a lone "Max Mustermann" line or "Name: Max Mustermann".
const NON_NAMES = new Set([
  "lebenslauf", "curriculum", "vitae", "bewerbung", "profil", "kontakt",
  "anschreiben", "steckbrief", "resume", "cv", "der", "die", "das",
  // Common CV section headings that would otherwise be read as surnames
  "berufserfahrung", "beruflicher", "werdegang", "ausbildung", "bildung",
  "kenntnisse", "fähigkeiten", "kompetenzen", "sprachen", "interessen",
  "persönliche", "daten", "zusammenfassung", "referenzen", "projekte",
  "zertifikate", "praxis", "studium", "weiterbildung", "berufsprofil",
]);

function looksLikeName(candidate) {
  const words = candidate.split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  return words.every((w) => !NON_NAMES.has(w.toLowerCase()));
}

export function runHeaderNames(text) {
  const findings = [];
  // Work over the first 12 physical lines
  const lines = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    lines.push({ line, offset });
    offset += line.length + 1;
    if (lines.length >= 12) break;
  }

  const nameLine = /^([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+){1,2})\s*$/;
  const labeled  = /^(?:name|vorname|nachname)\s*[:\-]\s*([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+){0,2})/i;

  for (const { line, offset: off } of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let m = trimmed.match(labeled) || trimmed.match(nameLine);
    if (m && looksLikeName(m[1])) {
      const name = m[1];
      const start = off + line.indexOf(name);
      findings.push(makeFinding({
        start, end: start + name.length, text: name, label: "PERSON", tier: 2,
        category: PII, confidence: 0.6,
      }));
      break; // only the first plausible name
    }
  }

  // All-caps headers split across paragraphs (common in multi-column DOCX):
  // "LENA" … "SCHMIDT". Only used when nothing else was found, and skips
  // section headings and job titles.
  if (findings.length === 0) {
    const NOT_NAME_CAPS = new Set([
      "deutsch", "englisch", "französisch", "spanisch", "italienisch",
      "telefon", "email", "adresse", "geburtsdatum", "staatsangehörigkeit",
      "familienstand", "kontakt", "profil", "mobil", "fax",
    ]);
    const caps = [];
    for (const { line, offset: off } of lines.slice(0, 8)) {
      const trimmed = line.trim();
      if (!/^[A-ZÄÖÜ][A-ZÄÖÜß]{1,20}$/.test(trimmed)) continue;
      const lower = trimmed.toLowerCase();
      if (NON_NAMES.has(lower) || NOT_NAME_CAPS.has(lower)) continue;
      if (DICT_ORIGINALS.has(lower)) continue;
      caps.push({ name: trimmed, start: off + line.indexOf(trimmed) });
    }
    if (caps.length >= 2) {
      caps.slice(0, 3).forEach(({ name, start }) => {
        findings.push(makeFinding({
          start, end: start + name.length, text: name, label: "PERSON", tier: 2,
          category: PII, confidence: 0.5,
        }));
      });
    }
  }

  // Salutations anywhere in the document: "Frau Müller", "Herrn Max Mustermann"
  const salutation = /(?<![\p{L}])(?:Herrn?|Frau)\s+([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)?)(?![\p{L}])/gu;
  let sm;
  while ((sm = salutation.exec(text)) !== null) {
    // A single surname after a salutation is valid ("Frau Müller"), but skip
    // candidates that contain a section heading ("Frau Profil").
    if (sm[1].split(/\s+/).some((w) => NON_NAMES.has(w.toLowerCase()))) continue;
    const name = sm[1];
    const start = sm.index + sm[0].indexOf(name);
    findings.push(makeFinding({
      start, end: start + name.length, text: name, label: "PERSON", tier: 2,
      category: PII, confidence: 0.65,
    }));
  }

  return findings;
}

// ── Merge: keep a non-overlapping, longest-first set of spans ───────────────
export function mergeFindings(all) {
  const sorted = [...all].sort((a, b) => a.start - b.start || b.end - a.end);
  const chosen = [];
  let lastEnd = -1;
  for (const f of sorted) {
    if (f.start >= lastEnd) {
      chosen.push(f);
      lastEnd = f.end;
    }
  }
  chosen.forEach((f, i) => { f.id = i; });
  return chosen;
}

export function detect(text) {
  const all = [
    ...runTier1(text),
    ...runHeaderNames(text),
    ...runTier3(text),
  ];
  return mergeFindings(all);
}