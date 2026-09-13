"use strict";

/* ---------- Pro-Status (Stub) ----------
   Platzhalter für den späteren Play-Billing-Ausbau. Gibt aktuell IMMER
   false zurück — jeder Nutzer ist also frei. Sobald Play Billing
   (Digital Goods API) angebunden ist, wird NUR diese eine Funktion
   ersetzt (z. B. durch eine Abfrage der Kaufhistorie über
   window.getDigitalGoodsService(...) bzw. ein serverseitig verifiziertes
   Entitlement) — der Rest der App muss dafür nicht angefasst werden.
   Feature-Gating später einfach so einbauen: if (!isPro()) { ... Hinweis
   auf Pro-Upgrade zeigen ... }. */
function isPro() {
  return false;
}

/* ---------- Datumshilfen & Feiertagslogik (Deutschland / NRW) ---------- */

function pad(n) { return String(n).padStart(2, "0"); }
function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function isWeekend(d) { const day = d.getDay(); return day === 0 || day === 6; }

function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const dd = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - dd - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
function germanHolidays(year) {
  const easter = easterSunday(year);
  const list = [
    new Date(year, 0, 1), addDays(easter, -2), addDays(easter, 1),
    new Date(year, 4, 1), addDays(easter, 39), addDays(easter, 50),
    addDays(easter, 60), new Date(year, 9, 3), new Date(year, 10, 1),
    new Date(year, 11, 25), new Date(year, 11, 26),
  ];
  return new Set(list.map(toISO));
}
const holidayCache = {};
function isHoliday(d) {
  const y = d.getFullYear();
  if (!holidayCache[y]) holidayCache[y] = germanHolidays(y);
  return holidayCache[y].has(toISO(d));
}
function isBusinessDay(d) { return !isWeekend(d) && !isHoliday(d); }
function computeRetourenDeadline(erhaltenISO) {
  let d = addDays(parseISO(erhaltenISO), 14);
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return toISO(d);
}
function daysUntil(iso) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = parseISO(iso); target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}
function formatDate(iso) {
  return parseISO(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/* ---------- OCR: Text aus Belegfotos lesen (on-device, Tesseract.js) ----------
   Standard-Umfang: liest Datum, Betrag und einen Anbieter-Vorschlag aus dem
   Foto und trägt sie ins Formular ein — der Mensch prüft/korrigiert danach.
   Läuft komplett im Browser, es wird kein Bild irgendwohin hochgeladen. */

let ocrWorkerPromise = null;
function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      if (typeof Tesseract === "undefined") throw new Error("Tesseract.js nicht geladen");
      return Tesseract.createWorker("deu");
    })();
  }
  return ocrWorkerPromise;
}

if (typeof pdfjsLib !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
}

// Liest Text aus einem PDF. Digital erzeugte PDFs (Rechnungen, Bescheide)
// haben fast immer eine Textebene — die wird direkt ausgelesen (schnell,
// exakt). Enthält das PDF kaum Text (z. B. ein eingescanntes Dokument),
// wird die erste Seite stattdessen als Bild gerendert und per OCR gelesen.
async function extractTextFromPdf(file) {
  if (typeof pdfjsLib === "undefined") throw new Error("PDF.js nicht geladen");
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const maxPages = Math.min(pdf.numPages, 3);
  let text = "";
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += "\n" + content.items.map((it) => it.str || "").join(" ");
  }
  if (text.trim().length < 20) {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(canvas.toDataURL("image/png"));
    text = (data && data.text) || "";
  }
  return text;
}

function toValidDate(dStr, moStr, yStr) {
  let d = parseInt(dStr, 10), mo = parseInt(moStr, 10), y = parseInt(yStr, 10);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d);
  if (isNaN(date.getTime())) return null;
  return date;
}

// Welches Datum "das richtige" ist, hängt von der Kategorie ab: bei einer
// Retoure will man das Erhalten-/Lieferdatum (meist im Kopfbereich), bei
// Rechnung/Abo/Strafzettel dagegen die Frist bzw. das Fälligkeitsdatum —
// die typischerweise WEITER UNTEN im Text steht, oft hinter Begriffen wie
// "Zahlbar bis" oder "Zahlungsziel". Ein einzelnes generisches Schlüsselwort
// wie "Datum" matcht sonst zu früh (z. B. im Briefkopf) und übersticht die
// eigentlich gesuchte Frist. Deshalb: mehrere Prioritätsstufen, spezifischste
// zuerst; erst wenn eine Stufe nichts findet, wird die nächste geprüft.
const DATE_KEYWORD_TIERS_BY_TYPE = {
  retoure: [
    ["erhalten", "zugestellt", "zustellung", "lieferdatum", "liefertermin"],
    ["bestelldatum", "auftragsdatum"],
    ["datum"],
  ],
  abo: [
    ["kündigungsfrist", "kuendigungsfrist", "vertragsende", "laufzeitende"],
    ["frist", "stichtag"],
    ["datum"],
  ],
  strafzettel: [
    ["einspruchsfrist", "zahlungsfrist", "zahlbar bis", "zahlungsziel"],
    ["frist", "fällig", "faellig"],
    ["datum"],
  ],
  rechnung: [
    ["zahlbar bis", "zahlungsziel", "fälligkeitsdatum", "faelligkeitsdatum", "zahlungsfrist"],
    ["fällig", "faellig", "frist"],
    ["rechnungsdatum", "datum"],
  ],
};

function parseDateFromText(text, type) {
  const dateRegex = /(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/g;
  const lines = text.split("\n");
  const tiers = DATE_KEYWORD_TIERS_BY_TYPE[type] || DATE_KEYWORD_TIERS_BY_TYPE.rechnung;

  for (const tier of tiers) {
    const tierRegex = new RegExp(tier.join("|"), "i");
    for (let i = 0; i < lines.length; i++) {
      if (!tierRegex.test(lines[i])) continue;
      // Datum meist in derselben Zeile wie das Schlüsselwort — bei
      // OCR-Tabellen landet es manchmal aber in einer der nächsten Zeilen.
      for (let j = i; j <= Math.min(i + 2, lines.length - 1); j++) {
        dateRegex.lastIndex = 0;
        let m;
        while ((m = dateRegex.exec(lines[j]))) {
          const d = toValidDate(m[1], m[2], m[3]);
          if (d) return d;
        }
      }
    }
  }

  // Kein Schlüsselwort getroffen: Fallback auf alle gefundenen Daten. Bei
  // einer Retoure ist meist das erste Datum im Dokument das richtige
  // (Lieferschein-Kopf), bei allen anderen Typen eher das letzte
  // (Fristen/Zahlungsbedingungen stehen oft im unteren Textbereich).
  const allDates = [];
  for (const line of lines) {
    dateRegex.lastIndex = 0;
    let m;
    while ((m = dateRegex.exec(line))) {
      const d = toValidDate(m[1], m[2], m[3]);
      if (d) allDates.push(d);
    }
  }
  if (allDates.length === 0) return null;
  return type === "retoure" ? allDates[0] : allDates[allDates.length - 1];
}

function parseGermanNumber(str) {
  return parseFloat(str.replace(/\./g, "").replace(",", "."));
}

// Bevorzugt Beträge in der Nähe von "Gesamt/Summe/Betrag", sonst den
// größten gefundenen Euro-Betrag im Text (meist die Gesamtsumme).
// Bevorzugt eindeutige Gesamtsummen-Angaben; "Nettobetrag" oder
// "Zwischensumme" werden bewusst übersprungen, damit nicht versehentlich
// eine Zwischensumme statt der tatsächlichen Gesamtsumme erkannt wird
// (die generische Zeichenkette "betrag" matcht sonst auch in "Nettobetrag").
function parseAmountFromText(text) {
  const skipLine = /(netto|zwischensumme|MwSt-?Satz)/i;
  const tiers = [
    /(gesamtbetrag|endbetrag|rechnungsbetrag|gesamtsumme|zu\s?zahlen(?:der\s?betrag)?|zahlbetrag)[^\d]{0,15}(\d{1,3}(?:\.\d{3})*,\d{2})/i,
    /\b(gesamt|summe|betrag)[^\d]{0,15}(\d{1,3}(?:\.\d{3})*,\d{2})/i,
  ];
  for (const tier of tiers) {
    for (const line of text.split("\n")) {
      if (skipLine.test(line)) continue;
      const m = tier.exec(line);
      if (m) return parseGermanNumber(m[2]);
    }
  }
  const anyRegex = /(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  let best = null;
  let m;
  while ((m = anyRegex.exec(text))) {
    const val = parseGermanNumber(m[1]);
    if (!isNaN(val) && (best === null || val > best)) best = val;
  }
  return best;
}

// Naiver Anbieter-Vorschlag: erste plausible Textzeile (meist Firmenname
// im Kopf des Belegs). Nur ein Vorschlag, der Mensch prüft ihn.
function guessMerchant(text) {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.length < 2 || line.length > 40) continue;
    if (/^[\d.,\-\/\s€]+$/.test(line)) continue;
    return line;
  }
  return null;
}

// IBAN-Prüfsumme (ISO 7064 MOD 97-10): erste 4 Zeichen ans Ende verschieben,
// Buchstaben in Zahlen umwandeln (A=10 … Z=35), Rest bei Division durch 97
// muss 1 ergeben. Damit lassen sich echte IBANs von zufälligen Zahlenfolgen
// im OCR-Text unterscheiden.
function ibanChecksumValid(iban) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const converted = rearranged.replace(/[A-Z]/g, (c) => (c.charCodeAt(0) - 55).toString());
  let remainder = converted;
  while (remainder.length > 9) {
    const chunk = remainder.slice(0, 9);
    remainder = (parseInt(chunk, 10) % 97).toString() + remainder.slice(chunk.length);
  }
  return parseInt(remainder, 10) % 97 === 1;
}
function formatIban(iban) {
  return iban.replace(/(.{4})(?=.)/g, "$1 ");
}
// Sucht IBAN-ähnliche Zeichenketten im Text (toleriert die übliche
// Leerzeichen-Gruppierung, z. B. "DE89 3704 0044 0532 0130 00"). OCR reißt
// Zeilenumbrüche manchmal falsch zusammen (z. B. hängt sich ein folgendes
// "BIC" an) — deshalb wird nicht nur der volle Regex-Treffer genommen,
// sondern für jede mögliche Länge geprüft, ob die Prüfsumme stimmt. Das
// findet zuverlässig das Ende der echten IBAN, unabhängig von OCR-Ausreißern.
function parseIbanFromText(text) {
  const compact = text.replace(/[\r\n]/g, " ");
  const ibanRegex = /\b([A-Z]{2}[ ]?\d{2}(?:[ ]?[A-Z0-9]){10,30})\b/g;
  const candidates = [];
  let m;
  while ((m = ibanRegex.exec(compact))) {
    const clean = m[1].replace(/\s+/g, "").toUpperCase();
    if (clean.length >= 15 && clean.length <= 34) candidates.push(clean);
  }
  if (candidates.length === 0) return null;
  for (const candidate of candidates) {
    for (let len = candidate.length; len >= 15; len--) {
      const trimmed = candidate.slice(0, len);
      if (ibanChecksumValid(trimmed)) return trimmed;
    }
  }
  return candidates[0].slice(0, 22); // Fallback ohne Prüfsummentreffer (z. B. bei Lesefehlern)
}

// Typabhängige Referenznummer-Erkennung: sucht in der Nähe passender
// Schlüsselwörter nach einem Code (Kundennummer, Rechnungsnummer,
// Aktenzeichen …). Kein Treffer ist besser als ein falscher — daher recht
// enge Muster statt "irgendeine Zahl im Text".
const REFERENCE_KEYWORDS_BY_TYPE = {
  rechnung: ["rechnungsnummer", "rechnungs-nr", "rechnungsnr", "rg-nr", "belegnummer", "beleg-nr", "verwendungszweck", "referenznummer", "kundennummer", "kd-nr", "kdnr"],
  abo: ["kundennummer", "kd-nr", "kdnr", "vertragsnummer", "mitgliedsnummer", "mitgliedsnr"],
  strafzettel: ["aktenzeichen", "bescheidnummer", "geschäftszeichen", "geschaeftszeichen", "vorgangsnummer"],
};
function parseReferenceFromText(text, type) {
  const keywords = REFERENCE_KEYWORDS_BY_TYPE[type];
  if (!keywords) return null;
  const keywordRegex = new RegExp(`(?:${keywords.join("|")})[:\\s]*([A-Za-zÄÖÜäöü0-9][A-Za-zÄÖÜäöü0-9\\-\\/\\.]{2,24})`, "i");
  for (const line of text.split("\n")) {
    const m = keywordRegex.exec(line);
    if (m && m[1]) {
      const val = m[1].trim();
      if (/^[a-zA-ZäöüÄÖÜ]+$/.test(val) && val.length < 4) continue; // z. B. nur "Nr" erwischt
      return val;
    }
  }
  return null;
}

// Zahlungsempfänger: sucht explizite Kennzeichnung im Text. Ohne Treffer
// überlässt runOcr() das Feld dem bereits erkannten Anbieter-Namen als
// vernünftiger Standardannahme (Rechnungssteller = Kontoinhaber ist der
// Normalfall).
function parseRecipientFromText(text) {
  const keywordRegex = /(?:zahlungsempf[aä]nger|empf[aä]nger|kontoinhaber|beg[uü]nstigter)[:\s]+([^\n]{2,60})/i;
  const m = keywordRegex.exec(text);
  if (m && m[1]) {
    const val = m[1].trim().replace(/\s{2,}/g, " ");
    if (val.length >= 2) return val;
  }
  return null;
}

/* ---------- Statuslogik ---------- */

function statusOf(entry) {
  if (entry.status === "erledigt") return "erledigt";
  const dleft = daysUntil(entry.deadline);
  if (dleft < 0) return "abgelaufen";
  if (dleft <= 3) return "dringend";
  if (dleft <= 7) return "bald";
  return "sicher";
}
const STATUS_META = {
  dringend: { label: "Dringend", color: "var(--red)" },
  bald: { label: "Bald fällig", color: "var(--amber)" },
  sicher: { label: "Sicher", color: "var(--green)" },
  abgelaufen: { label: "Abgelaufen", color: "var(--slate)" },
  erledigt: { label: "Erledigt", color: "var(--slate)" },
};
const TYPE_META = {
  retoure: { label: "Widerruf / Retoure" },
  abo: { label: "Abo-Kündigung" },
  strafzettel: { label: "Strafzettel" },
  rechnung: { label: "Offene Rechnung" },
};
function formatEuro(amount) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);
}

/* ---------- Speicherung (localStorage) ---------- */

const STORAGE_KEY = "fw_entries";
const NOTIFIED_KEY = "fw_notified_on";
const SENDER_KEY = "fw_sender";

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function saveEntries(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch (e) {
    showError("Speichern fehlgeschlagen (evtl. Speicher voll). Alte Belege ggf. löschen.");
    return false;
  }
}
function loadSender() {
  try {
    const raw = localStorage.getItem(SENDER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function saveSenderData(sender) {
  localStorage.setItem(SENDER_KEY, JSON.stringify(sender));
}

let entries = loadEntries();
let filter = "aktiv";
let currentBeleg = null;

/* ---------- Bild-Verkleinerung ---------- */

function resizeImage(file, maxWidth = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------- Rendering ---------- */

const $ = (sel) => document.querySelector(sel);
const listEl = $("#fw-list");
const statDringend = $("#stat-dringend");
const statBald = $("#stat-bald");
const statAktiv = $("#stat-aktiv");
const statGesamt = $("#stat-gesamt");
const errorBox = $("#fw-error");

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = "block";
  setTimeout(() => { errorBox.style.display = "none"; }, 5000);
}

function render() {
  const active = entries.filter((e) => e.status !== "erledigt");
  const dringend = active.filter((e) => ["dringend", "abgelaufen"].includes(statusOf(e)));
  const bald = active.filter((e) => statusOf(e) === "bald");

  statDringend.textContent = dringend.length;
  statBald.textContent = bald.length;
  statAktiv.textContent = active.length;
  statGesamt.textContent = entries.length;

  const visible = entries
    .filter((e) => {
      if (filter === "aktiv") return e.status !== "erledigt";
      if (filter === "erledigt") return e.status === "erledigt";
      return true;
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "erledigt" ? 1 : -1;
      return parseISO(a.deadline) - parseISO(b.deadline);
    });

  listEl.innerHTML = "";
  if (visible.length === 0) {
    listEl.innerHTML = `<div class="fw-empty">
      <div class="fw-empty-title">Noch nichts eingetragen</div>
      <p>Trage eine Bestellung oder ein Abo ein — die Frist wird automatisch berechnet.</p>
    </div>`;
    return;
  }
  visible.forEach((entry) => listEl.appendChild(renderCard(entry)));
}

function stampSVG(status, dleft) {
  const meta = STATUS_META[status];
  let big = "", small = "";
  if (status === "erledigt") { big = "OK"; small = "ERLEDIGT"; }
  else if (status === "abgelaufen") { big = String(Math.abs(dleft)); small = "TAGE ÜBERFÄLLIG"; }
  else { big = String(dleft); small = dleft === 1 ? "TAG ÜBRIG" : "TAGE ÜBRIG"; }
  const fontSize = big.length > 2 ? 20 : 26;
  return `
  <svg viewBox="0 0 100 100" width="70" height="70" class="fw-stamp" aria-hidden="true">
    <g transform="rotate(-9 50 50)">
      <circle cx="50" cy="50" r="46" fill="none" stroke="${meta.color}" stroke-width="2.5" stroke-dasharray="3 3" opacity="0.85"/>
      <circle cx="50" cy="50" r="38" fill="none" stroke="${meta.color}" stroke-width="1.4" opacity="0.9"/>
      <text x="50" y="48" text-anchor="middle" font-size="${fontSize}" font-weight="800" fill="${meta.color}" font-family="var(--font-mono)">${big}</text>
      <text x="50" y="66" text-anchor="middle" font-size="7.2" font-weight="700" letter-spacing="0.5" fill="${meta.color}" font-family="var(--font-mono)">${small}</text>
    </g>
  </svg>`;
}

function metaLine(entry) {
  let base;
  if (entry.type === "retoure") base = `Erhalten: ${formatDate(entry.erhalten)} · Fristende: ${formatDate(entry.deadline)}`;
  else if (entry.type === "abo") base = `Frist/Stichtag: ${formatDate(entry.deadline)}`;
  else if (entry.type === "strafzettel") base = `Zahlungs-/Einspruchsfrist: ${formatDate(entry.deadline)}`;
  else if (entry.type === "rechnung") base = `Fällig am: ${formatDate(entry.deadline)}`;
  else base = `Fristende: ${formatDate(entry.deadline)}`;
  if (entry.betrag !== null && entry.betrag !== undefined && entry.betrag !== "") {
    base += ` · ${formatEuro(Number(entry.betrag))}`;
  }
  if (entry.referenz) {
    base += ` · Ref.: ${entry.referenz}`;
  }
  return base;
}

function renderCard(entry) {
  const status = statusOf(entry);
  const dleft = daysUntil(entry.deadline);
  const isErledigt = entry.status === "erledigt";
  const meta = STATUS_META[status];

  const card = document.createElement("div");
  card.className = `fw-card ${isErledigt ? "is-erledigt" : ""}`;
  card.innerHTML = `
    ${stampSVG(status, dleft)}
    <div class="fw-card-body">
      <div class="fw-card-top">
        <span class="fw-type-badge">${TYPE_META[entry.type] ? TYPE_META[entry.type].label : entry.type}</span>
        <span class="fw-type-badge" style="color:${meta.color};border-color:${meta.color}">${meta.label}</span>
      </div>
      <p class="fw-produkt ${isErledigt ? "strike" : ""}"></p>
      <p class="fw-meta"></p>
      ${entry.notiz ? `<p class="fw-notiz"></p>` : ""}
      ${entry.type === "rechnung" && entry.iban ? `<p class="fw-notiz" id="iban-line" style="font-family:var(--font-mono)"></p>` : ""}
      <div class="fw-actions">
        <button class="fw-action" data-action="toggle">${isErledigt ? "Wieder aktivieren" : "Als erledigt markieren"}</button>
        ${entry.beleg ? `<button class="fw-action" data-action="view">Beleg ansehen</button>` : ""}
        ${entry.type === "abo" ? `<button class="fw-action" data-action="letter">Kündigung erstellen</button>` : ""}
        ${entry.type === "abo" ? `<button class="fw-action" data-action="compare">Alternativen vergleichen</button>` : ""}
        ${entry.type === "strafzettel" ? `<button class="fw-action" data-action="letter">Einspruch erstellen</button>` : ""}
        ${entry.type === "rechnung" && entry.iban ? `<button class="fw-action" data-action="copy-iban">IBAN kopieren</button>` : ""}
        <button class="fw-action danger" data-action="delete">Löschen</button>
      </div>
    </div>
  `;
  // Texte per textContent setzen (XSS-sicher bei Nutzereingaben)
  card.querySelector(".fw-produkt").textContent = entry.produkt;
  card.querySelector(".fw-meta").textContent = metaLine(entry);
  if (entry.notiz) card.querySelector(".fw-notiz").textContent = entry.notiz;
  const ibanLine = card.querySelector("#iban-line");
  if (ibanLine) {
    ibanLine.textContent = `${entry.empfaenger ? entry.empfaenger + " · " : ""}${entry.iban}`;
  }

  card.querySelector('[data-action="toggle"]').addEventListener("click", () => {
    entry.status = entry.status === "erledigt" ? "aktiv" : "erledigt";
    saveEntries(entries);
    render();
  });
  const viewBtn = card.querySelector('[data-action="view"]');
  if (viewBtn) viewBtn.addEventListener("click", () => openViewer(entry.beleg));
  const letterBtn = card.querySelector('[data-action="letter"]');
  if (letterBtn) letterBtn.addEventListener("click", () => generateLetterPdf(entry));
  const compareBtn = card.querySelector('[data-action="compare"]');
  if (compareBtn) compareBtn.addEventListener("click", () => generateComparePdf(entry));
  const copyIbanBtn = card.querySelector('[data-action="copy-iban"]');
  if (copyIbanBtn) {
    copyIbanBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(entry.iban.replace(/\s+/g, ""));
        copyIbanBtn.textContent = "Kopiert ✓";
        setTimeout(() => { copyIbanBtn.textContent = "IBAN kopieren"; }, 1500);
      } catch (e) {
        window.alert(entry.iban);
      }
    });
  }
  card.querySelector('[data-action="delete"]').addEventListener("click", () => {
    if (!confirm(`"${entry.produkt}" wirklich löschen?`)) return;
    entries = entries.filter((e) => e.id !== entry.id);
    saveEntries(entries);
    render();
  });

  return card;
}

/* ---------- Tabs ---------- */

document.querySelectorAll(".fw-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    filter = btn.dataset.filter;
    document.querySelectorAll(".fw-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    render();
  });
});

/* ---------- Modal: neue Frist ---------- */

const overlay = $("#fw-overlay");
const form = $("#fw-form");
const typeOpts = document.querySelectorAll(".fw-type-opt");
// Jeder Typ (außer "retoure", der die 14-Tage-Berechnung nutzt) hat ein
// eigenes Datumsfeld, in das der Stichtag direkt eingetragen wird.
const DIRECT_DATE_FIELDS = {
  abo: { field: $("#field-abo"), input: $("#input-abo") },
  strafzettel: { field: $("#field-strafzettel"), input: $("#input-strafzettel") },
  rechnung: { field: $("#field-rechnung"), input: $("#input-rechnung") },
};
const erhaltenField = $("#field-erhalten");
const erhaltenInput = $("#input-erhalten");
const produktInput = $("#input-produkt");
const betragInput = $("#input-betrag");
const notizInput = $("#input-notiz");
const fieldReferenz = $("#field-referenz");
const labelReferenz = $("#label-referenz");
const hintReferenz = $("#hint-referenz");
const referenzInput = $("#input-referenz");
const fieldAdresse = $("#field-adresse");
const labelAdresse = $("#label-adresse");
const adresseInput = $("#input-adresse");
const fieldZahlung = $("#field-zahlung");
const empfaengerInput = $("#input-empfaenger");
const ibanInput = $("#input-iban");
const fileInput = $("#input-file");
const previewLine = $("#preview-line");
const fileRow = $("#file-row");
const fileError = $("#file-error");
const ocrStatus = $("#ocr-status");
const saveBtn = $("#btn-save");

let currentType = "retoure";
let currentBelegDraft = null;
// Verhindert, dass eine spät eintreffende OCR-Vermutung ein Feld
// überschreibt, das der Mensch inzwischen selbst bearbeitet hat.
let dateTouched = false;
let betragTouched = false;
let produktTouched = false;
let referenzTouched = false;
let ibanTouched = false;
let empfaengerTouched = false;

const REFERENZ_LABELS = {
  abo: { label: "Kundennummer (optional)", hint: "Wird, falls angegeben, im Kündigungsschreiben genannt." },
  strafzettel: { label: "Aktenzeichen / Bescheidnummer (optional)", hint: "Wird, falls angegeben, im Einspruchsschreiben genannt." },
  rechnung: { label: "Rechnungs-/Verwendungszweck-Nummer (optional)", hint: "Praktisch als Verwendungszweck bei der Überweisung." },
};

function setVisibleFields(type) {
  erhaltenField.style.display = type === "retoure" ? "block" : "none";
  Object.entries(DIRECT_DATE_FIELDS).forEach(([key, { field }]) => {
    field.style.display = key === type ? "block" : "none";
  });

  const refMeta = REFERENZ_LABELS[type];
  fieldReferenz.style.display = refMeta ? "block" : "none";
  if (refMeta) {
    labelReferenz.textContent = refMeta.label;
    hintReferenz.textContent = refMeta.hint;
  }

  const showAdresse = type === "abo" || type === "strafzettel";
  fieldAdresse.style.display = showAdresse ? "block" : "none";
  if (showAdresse) {
    labelAdresse.textContent = type === "abo" ? "Anbieter-Adresse (optional)" : "Behörden-/Anbieteradresse (optional)";
    adresseInput.placeholder = type === "abo"
      ? "Firma GmbH\nMusterstraße 2\n12345 Musterstadt"
      : "Bußgeldstelle Musterstadt\nMusterstraße 2\n12345 Musterstadt";
  }

  fieldZahlung.style.display = type === "rechnung" ? "block" : "none";
}

function openModal() {
  currentType = "retoure";
  currentBelegDraft = null;
  dateTouched = false;
  betragTouched = false;
  produktTouched = false;
  referenzTouched = false;
  ibanTouched = false;
  empfaengerTouched = false;
  produktInput.value = "";
  betragInput.value = "";
  notizInput.value = "";
  referenzInput.value = "";
  adresseInput.value = "";
  empfaengerInput.value = "";
  ibanInput.value = "";
  erhaltenInput.value = toISO(new Date());
  Object.values(DIRECT_DATE_FIELDS).forEach(({ input }) => { input.value = toISO(addDays(new Date(), 14)); });
  fileInput.value = "";
  fileRow.style.display = "none";
  fileError.style.display = "none";
  ocrStatus.style.display = "none";
  typeOpts.forEach((o) => o.classList.toggle("active", o.dataset.type === "retoure"));
  setVisibleFields("retoure");
  updatePreview();
  overlay.style.display = "flex";
  produktInput.focus();
}
function closeModal() { overlay.style.display = "none"; }

function activeDateInput() {
  if (currentType === "retoure") return erhaltenInput;
  const conf = DIRECT_DATE_FIELDS[currentType];
  return conf ? conf.input : null;
}

function currentDeadline() {
  if (currentType === "retoure") return computeRetourenDeadline(erhaltenInput.value || toISO(new Date()));
  const conf = DIRECT_DATE_FIELDS[currentType];
  return (conf && conf.input.value) || toISO(new Date());
}
function updatePreview() {
  const deadline = currentDeadline();
  const d = daysUntil(deadline);
  const rest = d >= 0 ? `noch ${d} Tag${d === 1 ? "" : "e"}` : `${Math.abs(d)} Tag${Math.abs(d) === 1 ? "" : "e"} überfällig`;
  previewLine.textContent = `${formatDate(deadline)} (${rest})`;
}

typeOpts.forEach((opt) => {
  opt.addEventListener("click", () => {
    currentType = opt.dataset.type;
    typeOpts.forEach((o) => o.classList.toggle("active", o === opt));
    setVisibleFields(currentType);
    updatePreview();
  });
});
erhaltenInput.addEventListener("input", () => { dateTouched = true; });
erhaltenInput.addEventListener("change", updatePreview);
Object.values(DIRECT_DATE_FIELDS).forEach(({ input }) => {
  input.addEventListener("input", () => { dateTouched = true; });
  input.addEventListener("change", updatePreview);
});
betragInput.addEventListener("input", () => { betragTouched = true; });
referenzInput.addEventListener("input", () => { referenzTouched = true; });
ibanInput.addEventListener("input", () => { ibanTouched = true; });
empfaengerInput.addEventListener("input", () => { empfaengerTouched = true; });
produktInput.addEventListener("input", () => {
  produktTouched = true;
  saveBtn.disabled = !produktInput.value.trim();
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  fileError.style.display = "none";
  ocrStatus.style.display = "none";
  try {
    if (file.type === "application/pdf") {
      if (file.size > 2.5 * 1024 * 1024) {
        fileError.textContent = "PDF ist größer als 2,5 MB — es wird nur der Dateiname gespeichert.";
        fileError.style.display = "block";
        currentBelegDraft = { name: file.name, mime: file.type, dataUrl: null };
        showFileRow();
        runOcr(file); // Texterkennung funktioniert unabhängig von der Speicherung
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        currentBelegDraft = { name: file.name, mime: file.type, dataUrl: ev.target.result };
        showFileRow();
      };
      reader.readAsDataURL(file);
      runOcr(file);
    } else {
      const dataUrl = await resizeImage(file);
      currentBelegDraft = { name: file.name, mime: "image/jpeg", dataUrl };
      showFileRow();
      runOcr(file); // im Hintergrund, blockiert das Formular nicht
    }
  } catch (e) {
    fileError.textContent = "Datei konnte nicht gelesen werden.";
    fileError.style.display = "block";
  }
});

// Liefert erkannten Text — aus der Textebene eines PDFs (mit OCR-Fallback
// für gescannte PDFs) oder per Bild-OCR für Fotos.
async function getTextFromFile(file) {
  if (file.type === "application/pdf") return extractTextFromPdf(file);
  // Eigene, etwas größere Version nur für die Texterkennung — die
  // gespeicherte Beleg-Vorschau bleibt bei der kleineren Auflösung.
  const ocrDataUrl = await resizeImage(file, 1500, 0.9);
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(ocrDataUrl);
  return (data && data.text) || "";
}

async function runOcr(file) {
  ocrStatus.style.display = "block";
  ocrStatus.style.color = "var(--slate)";
  ocrStatus.textContent = file.type === "application/pdf" ? "PDF wird gelesen …" : "Beleg wird gelesen …";
  try {
    const text = await getTextFromFile(file);
    const applied = [];

    if (!dateTouched) {
      const guessedDate = parseDateFromText(text, currentType);
      const input = activeDateInput();
      if (guessedDate && input) {
        input.value = toISO(guessedDate);
        updatePreview();
        applied.push("Datum");
      }
    }
    if (!betragTouched) {
      const amount = parseAmountFromText(text);
      if (amount !== null && !isNaN(amount)) {
        betragInput.value = amount.toFixed(2);
        applied.push("Betrag");
      }
    }
    if (!produktTouched && !produktInput.value.trim()) {
      const merchant = guessMerchant(text);
      if (merchant) {
        produktInput.value = merchant;
        saveBtn.disabled = false;
        applied.push("Anbieter");
      }
    }
    if (!referenzTouched && (currentType === "abo" || currentType === "strafzettel" || currentType === "rechnung")) {
      const ref = parseReferenceFromText(text, currentType);
      if (ref) {
        referenzInput.value = ref;
        applied.push(currentType === "rechnung" ? "Referenznummer" : currentType === "abo" ? "Kundennummer" : "Aktenzeichen");
      }
    }
    if (currentType === "rechnung") {
      if (!ibanTouched) {
        const iban = parseIbanFromText(text);
        if (iban) {
          ibanInput.value = formatIban(iban);
          applied.push("IBAN");
        }
      }
      if (!empfaengerTouched) {
        const recipient = parseRecipientFromText(text) || produktInput.value.trim() || null;
        if (recipient) {
          empfaengerInput.value = recipient;
          applied.push("Zahlungsempfänger");
        }
      }
    }

    if (applied.length) {
      ocrStatus.style.color = "var(--green)";
      ocrStatus.textContent = `Aus dem Beleg erkannt: ${applied.join(", ")} — bitte prüfen.`;
    } else {
      ocrStatus.style.color = "var(--slate)";
      ocrStatus.textContent = "Im Beleg konnte nichts Eindeutiges erkannt werden.";
    }
  } catch (e) {
    ocrStatus.style.color = "var(--slate)";
    ocrStatus.textContent = "Texterkennung nicht verfügbar (evtl. kein Internet beim ersten Mal nötig).";
  }
}
function showFileRow() {
  fileRow.style.display = "flex";
  fileRow.innerHTML = "";
  if (currentBelegDraft.dataUrl && currentBelegDraft.mime !== "application/pdf") {
    const img = document.createElement("img");
    img.src = currentBelegDraft.dataUrl;
    img.className = "fw-file-thumb";
    fileRow.appendChild(img);
  } else {
    const span = document.createElement("span");
    span.textContent = "📄";
    fileRow.appendChild(span);
  }
  const name = document.createElement("span");
  name.textContent = currentBelegDraft.name;
  fileRow.appendChild(name);
}

$("#btn-add").addEventListener("click", openModal);
$("#fab-add").addEventListener("click", openModal);
$("#btn-cancel").addEventListener("click", closeModal);
overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeModal(); });

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!produktInput.value.trim()) return;
  const deadline = currentDeadline();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: currentType,
    produkt: produktInput.value.trim(),
    erhalten: currentType === "retoure" ? erhaltenInput.value : null,
    deadline,
    betrag: betragInput.value !== "" ? Number(betragInput.value) : null,
    notiz: notizInput.value.trim(),
    referenz: (currentType === "abo" || currentType === "strafzettel" || currentType === "rechnung") ? referenzInput.value.trim() : "",
    adresse: (currentType === "abo" || currentType === "strafzettel") ? adresseInput.value.trim() : "",
    empfaenger: currentType === "rechnung" ? empfaengerInput.value.trim() : "",
    iban: currentType === "rechnung" ? ibanInput.value.trim().toUpperCase() : "",
    beleg: currentBelegDraft,
    status: "aktiv",
    createdAt: new Date().toISOString(),
  };
  entries.unshift(entry);
  if (saveEntries(entries)) {
    closeModal();
    render();
    checkAndNotify(true);
  }
});

/* ---------- Beleg-Viewer ---------- */

const viewerOverlay = $("#fw-viewer-overlay");
const viewerBox = $("#fw-viewer-content");
function openViewer(beleg) {
  currentBeleg = beleg;
  viewerBox.innerHTML = "";
  if (beleg.dataUrl) {
    if (beleg.mime === "application/pdf") {
      const iframe = document.createElement("iframe");
      iframe.src = beleg.dataUrl;
      iframe.style.width = "80vw";
      iframe.style.height = "78vh";
      iframe.style.border = "none";
      viewerBox.appendChild(iframe);
    } else {
      const img = document.createElement("img");
      img.src = beleg.dataUrl;
      img.className = "fw-viewer-img";
      viewerBox.appendChild(img);
    }
  } else {
    const p = document.createElement("p");
    p.style.padding = "20px";
    p.textContent = `Datei zu groß für die lokale Vorschau: ${beleg.name}`;
    viewerBox.appendChild(p);
  }
  viewerOverlay.style.display = "flex";
}
$("#fw-viewer-close").addEventListener("click", () => { viewerOverlay.style.display = "none"; });
viewerOverlay.addEventListener("mousedown", (e) => { if (e.target === viewerOverlay) viewerOverlay.style.display = "none"; });

/* ---------- Benachrichtigungen (lokal, Best-Effort) ----------
   Echte Push-Benachrichtigungen bei komplett geschlossener App
   erfordern einen Server (Web Push API). Ohne Backend zeigen wir
   verlässlich Erinnerungen, sobald die App geöffnet wird bzw. im
   Hintergrund-Tab aktiv bleibt — plus einen Best-Effort-Versuch
   über die (eingeschränkt verfügbare) Periodic Background Sync API. */

const notifBanner = $("#fw-notif-banner");
const notifBtn = $("#fw-notif-btn");

function updateNotifBanner() {
  if (!("Notification" in window)) { notifBanner.style.display = "none"; return; }
  if (Notification.permission === "granted") { notifBanner.style.display = "none"; return; }
  if (Notification.permission === "denied") {
    notifBanner.querySelector("span").textContent = "Benachrichtigungen sind blockiert. Aktiviere sie in den Android-Einstellungen der App, um Erinnerungen zu erhalten.";
    notifBtn.style.display = "none";
    notifBanner.style.display = "flex";
    return;
  }
  notifBanner.querySelector("span").textContent = "Erinnerungen aktivieren, damit dringende Fristen dich benachrichtigen.";
  notifBtn.style.display = "inline-block";
  notifBanner.style.display = "flex";
}
notifBtn.addEventListener("click", async () => {
  const perm = await Notification.requestPermission();
  updateNotifBanner();
  if (perm === "granted") checkAndNotify(true);
  registerPeriodicSync();
});

function checkAndNotify(force = false) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const today = toISO(new Date());
  const notifiedOn = localStorage.getItem(NOTIFIED_KEY);
  if (!force && notifiedOn === today) return; // schon heute benachrichtigt
  const urgent = entries.filter((e) => e.status !== "erledigt" && ["dringend", "abgelaufen"].includes(statusOf(e)));
  if (urgent.length === 0) return;
  const body = urgent
    .slice(0, 3)
    .map((e) => {
      const d = daysUntil(e.deadline);
      return d < 0 ? `${e.produkt}: überfällig` : `${e.produkt}: noch ${d} Tag${d === 1 ? "" : "e"}`;
    })
    .join(" · ");
  const show = (reg) => {
    const opts = { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "fristen-waechter" };
    if (reg && reg.showNotification) reg.showNotification("Fristen-Wächter — dringende Fristen", opts);
    else new Notification("Fristen-Wächter — dringende Fristen", opts);
  };
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(show).catch(() => show(null));
  } else {
    show(null);
  }
  localStorage.setItem(NOTIFIED_KEY, today);
}

async function registerPeriodicSync() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ("periodicSync" in reg) {
      const status = await navigator.permissions.query({ name: "periodic-background-sync" });
      if (status.state === "granted") {
        await reg.periodicSync.register("fristen-check", { minInterval: 12 * 60 * 60 * 1000 });
      }
    }
  } catch (e) {
    // Nicht unterstützt — kein Problem, App prüft beim Öffnen weiterhin zuverlässig.
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkAndNotify();
});

/* ---------- Backup: Export & Import (optional passwortverschlüsselt) ----------
   Format: JSON-Wrapper { app, version, encrypted, ... , data }.
   Unverschlüsselt: data = Einträge-Array direkt.
   Verschlüsselt: data = Base64-Chiffretext (AES-GCM), Schlüssel wird aus dem
   Passwort per PBKDF2 (SHA-256, 200.000 Runden) + zufälligem Salt abgeleitet.
   Ver-/Entschlüsselung läuft komplett lokal über die Web-Crypto-API des
   Browsers — das Passwort verlässt nie das Gerät. */

const BACKUP_APP_ID = "fristen-waechter";
const PBKDF2_ITERATIONS = 200000;

function bufToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
async function deriveBackupKey(password, saltBytes, iterations) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptBackupData(entriesArray, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(password, salt, PBKDF2_ITERATIONS);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(entriesArray)));
  return {
    app: BACKUP_APP_ID,
    version: 1,
    encrypted: true,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: bufToBase64(salt),
    iv: bufToBase64(iv),
    data: bufToBase64(ciphertext),
  };
}
async function decryptBackupData(wrapper, password) {
  const salt = new Uint8Array(base64ToBuf(wrapper.salt));
  const iv = new Uint8Array(base64ToBuf(wrapper.iv));
  const key = await deriveBackupKey(password, salt, wrapper.iterations || PBKDF2_ITERATIONS);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base64ToBuf(wrapper.data));
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

/* ---- Header-Menü ---- */
const menuBtn = $("#btn-menu");
const menuDropdown = $("#menu-dropdown");
menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = menuDropdown.style.display === "block";
  menuDropdown.style.display = open ? "none" : "block";
  menuBtn.setAttribute("aria-expanded", String(!open));
});
document.addEventListener("click", () => { menuDropdown.style.display = "none"; });
menuDropdown.addEventListener("click", (e) => e.stopPropagation());

/* ---- Export ---- */
const exportOverlay = $("#export-overlay");
const exportEncryptToggle = $("#export-encrypt-toggle");
const exportPwField = $("#export-pw-field");
const exportPw2Field = $("#export-pw2-field");
const exportPw = $("#export-pw");
const exportPw2 = $("#export-pw2");
const exportError = $("#export-error");

$("#menu-export").addEventListener("click", () => {
  menuDropdown.style.display = "none";
  exportEncryptToggle.checked = false;
  exportPwField.style.display = "none";
  exportPw2Field.style.display = "none";
  exportPw.value = "";
  exportPw2.value = "";
  exportError.style.display = "none";
  exportOverlay.style.display = "flex";
});
$("#export-cancel").addEventListener("click", () => { exportOverlay.style.display = "none"; });
exportOverlay.addEventListener("mousedown", (e) => { if (e.target === exportOverlay) exportOverlay.style.display = "none"; });
exportEncryptToggle.addEventListener("change", () => {
  const on = exportEncryptToggle.checked;
  exportPwField.style.display = on ? "block" : "none";
  exportPw2Field.style.display = on ? "block" : "none";
});

$("#export-confirm").addEventListener("click", async () => {
  exportError.style.display = "none";
  const encrypt = exportEncryptToggle.checked;
  if (encrypt) {
    if (!window.isSecureContext || !window.crypto || !window.crypto.subtle) {
      exportError.textContent = "Verschlüsselung benötigt eine sichere (https) Verbindung.";
      exportError.style.display = "block";
      return;
    }
    if (exportPw.value.length < 6) {
      exportError.textContent = "Passwort sollte mindestens 6 Zeichen haben.";
      exportError.style.display = "block";
      return;
    }
    if (exportPw.value !== exportPw2.value) {
      exportError.textContent = "Die beiden Passwörter stimmen nicht überein.";
      exportError.style.display = "block";
      return;
    }
  }
  try {
    const wrapper = encrypt
      ? await encryptBackupData(entries, exportPw.value)
      : { app: BACKUP_APP_ID, version: 1, encrypted: false, data: entries };
    const blob = new Blob([JSON.stringify(wrapper)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fristen-waechter-backup-${toISO(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    exportOverlay.style.display = "none";
  } catch (e) {
    exportError.textContent = "Backup konnte nicht erstellt werden.";
    exportError.style.display = "block";
  }
});

/* ---- Import ---- */
const importOverlay = $("#import-overlay");
const importFileInput = $("#import-file");
const importPwField = $("#import-pw-field");
const importPw = $("#import-pw");
const importInfo = $("#import-info");
const importError = $("#import-error");
const importInitialActions = $("#import-initial-actions");
const importModeActions = $("#import-mode-actions");

let importWrapper = null;
let importedEntries = null;

function resetImportModal() {
  importWrapper = null;
  importedEntries = null;
  importFileInput.value = "";
  importPwField.style.display = "none";
  importPw.value = "";
  importInfo.style.display = "none";
  importError.style.display = "none";
  importInitialActions.style.display = "flex";
  importModeActions.style.display = "none";
}

$("#menu-import").addEventListener("click", () => {
  menuDropdown.style.display = "none";
  resetImportModal();
  importOverlay.style.display = "flex";
});
$("#import-cancel").addEventListener("click", () => { importOverlay.style.display = "none"; });
importOverlay.addEventListener("mousedown", (e) => { if (e.target === importOverlay) importOverlay.style.display = "none"; });

importFileInput.addEventListener("change", async () => {
  importError.style.display = "none";
  importInfo.style.display = "none";
  importModeActions.style.display = "none";
  importInitialActions.style.display = "flex";
  importedEntries = null;
  const file = importFileInput.files && importFileInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const wrapper = JSON.parse(text);
    if (!wrapper || wrapper.app !== BACKUP_APP_ID || !("data" in wrapper)) {
      importError.textContent = "Das ist keine gültige Fristen-Wächter-Backup-Datei.";
      importError.style.display = "block";
      importWrapper = null;
      return;
    }
    importWrapper = wrapper;
    if (wrapper.encrypted) {
      importPwField.style.display = "block";
      importInfo.style.display = "block";
      importInfo.textContent = "Verschlüsseltes Backup — bitte Passwort eingeben und \"Backup lesen\" klicken.";
    } else {
      importPwField.style.display = "none";
      const count = Array.isArray(wrapper.data) ? wrapper.data.length : 0;
      importInfo.style.display = "block";
      importInfo.textContent = `${count} Eintrag/Einträge in dieser Datei gefunden.`;
    }
  } catch (e) {
    importWrapper = null;
    importError.textContent = "Datei konnte nicht gelesen werden — ist es eine Backup-JSON-Datei?";
    importError.style.display = "block";
  }
});

$("#import-confirm").addEventListener("click", async () => {
  importError.style.display = "none";
  if (!importWrapper) {
    importError.textContent = "Bitte zuerst eine Backup-Datei auswählen.";
    importError.style.display = "block";
    return;
  }
  try {
    if (importWrapper.encrypted) {
      if (!importPw.value) {
        importError.textContent = "Bitte Passwort eingeben.";
        importError.style.display = "block";
        return;
      }
      importedEntries = await decryptBackupData(importWrapper, importPw.value);
    } else {
      importedEntries = importWrapper.data;
    }
    if (!Array.isArray(importedEntries)) throw new Error("Ungültiges Format");
    importInfo.style.display = "block";
    importInfo.textContent = `${importedEntries.length} Eintrag/Einträge bereit zur Wiederherstellung.`;
    importInitialActions.style.display = "none";
    importModeActions.style.display = "flex";
  } catch (e) {
    importedEntries = null;
    importError.textContent = "Falsches Passwort oder beschädigte Datei.";
    importError.style.display = "block";
  }
});

$("#import-merge").addEventListener("click", () => {
  if (!importedEntries) return;
  const existingIds = new Set(entries.map((e) => e.id));
  const toAdd = importedEntries.filter((e) => e && e.id && !existingIds.has(e.id));
  const next = [...toAdd, ...entries];
  persistAndReload(next, `${toAdd.length} neue Einträge hinzugefügt.`);
});
$("#import-replace").addEventListener("click", () => {
  if (!importedEntries) return;
  if (!confirm(`Alle ${entries.length} lokalen Einträge durch die ${importedEntries.length} Einträge aus dem Backup ersetzen? Das kann nicht rückgängig gemacht werden.`)) return;
  persistAndReload(importedEntries, `${importedEntries.length} Einträge wiederhergestellt.`);
});
function persistAndReload(next, message) {
  entries = next;
  saveEntries(entries);
  render();
  checkAndNotify(true);
  importOverlay.style.display = "none";
  window.alert(message);
}

/* ---- Feedback ---- */
const FEEDBACK_EMAIL = "echoreachai@gmail.com";
const feedbackOverlay = $("#feedback-overlay");
const feedbackText = $("#feedback-text");
const feedbackCounter = $("#feedback-counter");
const feedbackError = $("#feedback-error");
const feedbackSend = $("#feedback-send");

function updateFeedbackCounter() {
  const len = feedbackText.value.length;
  feedbackCounter.textContent = `${len} / 1500 Zeichen`;
  feedbackSend.disabled = feedbackText.value.trim().length === 0;
}
feedbackText.addEventListener("input", updateFeedbackCounter);

$("#menu-feedback").addEventListener("click", () => {
  menuDropdown.style.display = "none";
  feedbackText.value = "";
  feedbackError.style.display = "none";
  updateFeedbackCounter();
  feedbackOverlay.style.display = "flex";
  feedbackText.focus();
});
$("#feedback-cancel").addEventListener("click", () => { feedbackOverlay.style.display = "none"; });
feedbackOverlay.addEventListener("mousedown", (e) => { if (e.target === feedbackOverlay) feedbackOverlay.style.display = "none"; });

feedbackSend.addEventListener("click", () => {
  const message = feedbackText.value.trim();
  if (!message) return;
  feedbackError.style.display = "none";
  try {
    const subject = "Fristen-Wächter Feedback";
    const body = `${message}\n\n—\nGesendet aus der Fristen-Wächter App`;
    const mailto = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
    feedbackOverlay.style.display = "none";
  } catch (e) {
    feedbackError.textContent = "Mail-App konnte nicht geöffnet werden.";
    feedbackError.style.display = "block";
  }
});

/* ---- Absenderdaten ---- */
const senderOverlay = $("#sender-overlay");
const senderNameInput = $("#sender-name");
const senderStrasseInput = $("#sender-strasse");
const senderPlzOrtInput = $("#sender-plzort");
const senderError = $("#sender-error");

function openSenderModal() {
  const s = loadSender() || {};
  senderNameInput.value = s.name || "";
  senderStrasseInput.value = s.strasse || "";
  senderPlzOrtInput.value = s.plzOrt || "";
  senderError.style.display = "none";
  senderOverlay.style.display = "flex";
}
$("#menu-sender").addEventListener("click", () => { menuDropdown.style.display = "none"; openSenderModal(); });
$("#sender-cancel").addEventListener("click", () => { senderOverlay.style.display = "none"; });
senderOverlay.addEventListener("mousedown", (e) => { if (e.target === senderOverlay) senderOverlay.style.display = "none"; });
$("#sender-save").addEventListener("click", () => {
  const name = senderNameInput.value.trim();
  const strasse = senderStrasseInput.value.trim();
  const plzOrt = senderPlzOrtInput.value.trim();
  if (!name || !strasse || !plzOrt) {
    senderError.textContent = "Bitte alle drei Felder ausfüllen.";
    senderError.style.display = "block";
    return;
  }
  saveSenderData({ name, strasse, plzOrt });
  senderOverlay.style.display = "none";
});

/* ---- Kündigungs-/Einspruchsschreiben als PDF ----
   Erzeugt eine fertig formatierte Brief-Vorlage (DIN-5008-ähnlich) direkt
   im Browser (jsPDF) und bietet sie zum Download an. Ohne hinterlegte
   Anbieter-Adresse bleibt ein Platzhalter im Dokument stehen. Das ist eine
   Vorlage zum Prüfen vor dem Versand, keine Rechtsberatung — bei einem
   Einspruch ggf. noch eine eigene Begründung ergänzen. */

function generateLetterPdf(entry) {
  const sender = loadSender();
  if (!sender || !sender.name || !sender.strasse || !sender.plzOrt) {
    window.alert("Bitte zuerst deine Absenderdaten hinterlegen (Menü → Absenderdaten).");
    openSenderModal();
    return;
  }
  if (typeof window.jspdf === "undefined") {
    window.alert("PDF-Bibliothek konnte nicht geladen werden — bitte Internetverbindung prüfen und erneut versuchen.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const marginLeft = 25;
  const marginRight = 25;
  const pageWidth = 210;
  const textWidth = pageWidth - marginLeft - marginRight;
  let y = 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(90, 90, 90);
  [sender.name, sender.strasse, sender.plzOrt].forEach((line) => { doc.text(line, marginLeft, y); y += 4.2; });
  doc.setTextColor(0, 0, 0);
  y += 10;

  doc.setFontSize(10.5);
  doc.text(entry.produkt, marginLeft, y); y += 4.5;
  if (entry.adresse) {
    entry.adresse.split("\n").forEach((line) => {
      if (line.trim()) { doc.text(line.trim(), marginLeft, y); y += 4.5; }
    });
  } else {
    doc.setTextColor(150, 150, 150);
    doc.text("[Adresse des Empfängers hier ergänzen]", marginLeft, y);
    doc.setTextColor(0, 0, 0);
    y += 4.5;
  }
  y += 10;

  const ort = (sender.plzOrt || "").replace(/^\s*\d{4,6}\s*/, "").trim() || sender.plzOrt;
  const todayStr = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  doc.setFontSize(10);
  doc.text(`${ort}, den ${todayStr}`, pageWidth - marginRight, y, { align: "right" });
  y += 14;

  const isAbo = entry.type === "abo";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  const subject = isAbo
    ? `Kündigung: ${entry.produkt}${entry.referenz ? " – Kundennummer " + entry.referenz : ""}`
    : `Einspruch gegen Bußgeld-/Verwarnungsbescheid${entry.referenz ? " – Aktenzeichen " + entry.referenz : ""}`;
  const subjectLines = doc.splitTextToSize(subject, textWidth);
  doc.text(subjectLines, marginLeft, y);
  y += subjectLines.length * 5.5 + 9;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Sehr geehrte Damen und Herren,", marginLeft, y);
  y += 9;

  const bodyText = isAbo
    ? `hiermit kündige ich den oben genannten Vertrag ordentlich zum nächstmöglichen Zeitpunkt${entry.deadline ? ", spätestens zum " + formatDate(entry.deadline) : ""}.\n\nBitte bestätigen Sie mir den Erhalt dieser Kündigung sowie das genaue Vertragsende schriftlich.`
    : `gegen den oben genannten Bescheid lege ich hiermit form- und fristgerecht Einspruch ein.\n\nEine ausführliche Begründung reiche ich gegebenenfalls gesondert nach. Ich bitte um Bestätigung des Eingangs dieses Einspruchs.`;
  const bodyLines = doc.splitTextToSize(bodyText, textWidth);
  doc.text(bodyLines, marginLeft, y);
  y += bodyLines.length * 5.4 + 16;

  doc.text("Mit freundlichen Grüßen", marginLeft, y);
  y += 18;
  doc.text(sender.name, marginLeft, y);

  // Kleiner Hinweis unten: Vorlage, kein fertiges Rechtsdokument.
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  const disclaimer = "Automatisch erstellte Vorlage aus der Fristen-Wächter App. Bitte vor dem Versand prüfen und bei Bedarf ergänzen.";
  doc.text(doc.splitTextToSize(disclaimer, textWidth), marginLeft, 285);
  doc.setTextColor(0, 0, 0);

  const prefix = isAbo ? "Kuendigung" : "Einspruch";
  const safeName = entry.produkt.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").slice(0, 40) || "Schreiben";
  doc.save(`${prefix}_${safeName}.pdf`);
}

/* ---------- Alternativen-Vergleich (nur per Button, keine Automatik) ----------
   Bewusst KEINE fest eingebauten Preise: Abo-Preise ändern sich laufend,
   und die App hat keinen Server/keine Live-Recherche zur Laufzeit. Falsche
   Preisangaben wären hier schlimmer als gar keine. Stattdessen verweist die
   PDF auf die offizielle Anbieter-Seite (falls erkannt) und auf unabhängige
   Vergleichsportale — beides bleibt aktuell, weil es nur auf die Quelle
   verlinkt statt Zahlen zu kopieren. */

const KNOWN_PROVIDERS = [
  { match: ["netflix"], name: "Netflix", url: "https://www.netflix.com/de/" },
  { match: ["disney"], name: "Disney+", url: "https://www.disneyplus.com/de-de" },
  { match: ["amazon prime", "prime video"], name: "Amazon Prime Video", url: "https://www.primevideo.com/" },
  { match: ["spotify"], name: "Spotify", url: "https://www.spotify.com/de/premium/" },
  { match: ["dazn"], name: "DAZN", url: "https://www.dazn.com/de-DE/welcome" },
  { match: ["sky", "wow"], name: "WOW (ehem. Sky Ticket)", url: "https://www.wow.de/" },
  { match: ["apple tv"], name: "Apple TV+", url: "https://www.apple.com/de/apple-tv-plus/" },
  { match: ["youtube premium", "youtube music"], name: "YouTube Premium", url: "https://www.youtube.com/premium" },
  { match: ["audible"], name: "Audible", url: "https://www.audible.de/" },
  { match: ["paramount"], name: "Paramount+", url: "https://www.paramountplus.com/de/" },
  { match: ["magenta"], name: "MagentaTV", url: "https://www.telekom.de/magenta-tv" },
  { match: ["joyn"], name: "Joyn", url: "https://www.joyn.de/" },
];
function matchKnownProvider(produktName) {
  const lower = produktName.toLowerCase();
  return KNOWN_PROVIDERS.find((p) => p.match.some((m) => lower.includes(m))) || null;
}

function generateComparePdf(entry) {
  if (typeof window.jspdf === "undefined") {
    window.alert("PDF-Bibliothek konnte nicht geladen werden — bitte Internetverbindung prüfen und erneut versuchen.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const marginLeft = 25;
  const marginRight = 25;
  const pageWidth = 210;
  const textWidth = pageWidth - marginLeft - marginRight;
  let y = 24;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Alternativen-Vergleich", marginLeft, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Für: ${entry.produkt}`, marginLeft, y);
  y += 12;

  doc.setFontSize(9.5);
  doc.setTextColor(120, 120, 120);
  const introText = "Diese Seite verlinkt bewusst nur auf offizielle Seiten und Vergleichsportale, statt Preise fest anzugeben — Abo-Preise ändern sich laufend, dort findest du immer den aktuellen Stand.";
  const introLines = doc.splitTextToSize(introText, textWidth);
  doc.text(introLines, marginLeft, y);
  y += introLines.length * 4.6 + 10;
  doc.setTextColor(0, 0, 0);

  const provider = matchKnownProvider(entry.produkt);
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent("günstigere Alternative zu " + entry.produkt)}`;

  // Bei unbekannten Anbietern gibt's keinen sinnvollen "offiziellen Link" —
  // dafür öffnet sich direkt eine Google-Suche mit dem Eintragstitel als
  // Suchbegriff, damit sofort etwas Brauchbares da ist, statt nur ein
  // weiterer Link in der PDF. Der Klick auf den Button zählt als
  // Nutzer-Geste, Popup-Blocker greifen hier also nicht.
  if (!provider) {
    window.open(searchUrl, "_blank", "noopener");
  }

  if (provider) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Offizielle Seite (aktuelle Tarife/Pakete):", marginLeft, y);
    y += 6.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.text(`${provider.name}`, marginLeft, y);
    y += 5.5;
    doc.setTextColor(30, 80, 160);
    doc.textWithLink(`→ ${provider.url}`, marginLeft, y, { url: provider.url });
    doc.setTextColor(0, 0, 0);
    y += 12;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Unabhängige Vergleichsportale:", marginLeft, y);
  y += 6.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  const verivoxUrl = "https://www.verivox.de/streaming/angebote/";
  const check24Url = "https://www.check24.de/internet/streaming/";
  doc.text("Verivox Streaming-Vergleich", marginLeft, y);
  y += 5.5;
  doc.setTextColor(30, 80, 160);
  doc.textWithLink(`→ ${verivoxUrl}`, marginLeft, y, { url: verivoxUrl });
  doc.setTextColor(0, 0, 0);
  y += 8;
  doc.setFontSize(10.5);
  doc.text("Check24 Streaming-Vergleich", marginLeft, y);
  y += 5.5;
  doc.setTextColor(30, 80, 160);
  doc.textWithLink(`→ ${check24Url}`, marginLeft, y, { url: check24Url });
  doc.setTextColor(0, 0, 0);
  y += 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(!provider ? "Direkte Suche (wurde bereits geöffnet):" : "Direkte Suche:", marginLeft, y);
  y += 6.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  const searchLabel = doc.splitTextToSize(`"Günstigere Alternative zu ${entry.produkt}"`, textWidth);
  doc.text(searchLabel, marginLeft, y);
  y += searchLabel.length * 5 + 1.5;
  doc.setTextColor(30, 80, 160);
  doc.textWithLink("→ Google-Suche öffnen", marginLeft, y, { url: searchUrl });
  doc.setTextColor(0, 0, 0);
  y += 12;

  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  const disclaimer = "Automatisch erstellte Übersicht aus der Fristen-Wächter App. Enthält keine Preisangaben oder Empfehlungen — nur Links zu Seiten mit aktuellem Stand. Kein Kauf- oder Abo-Zwang, keine Provision.";
  doc.text(doc.splitTextToSize(disclaimer, textWidth), marginLeft, 285);
  doc.setTextColor(0, 0, 0);

  const safeName = entry.produkt.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").slice(0, 40) || "Abo";
  doc.save(`Alternativen_${safeName}.pdf`);
}

/* ---------- Service Worker registrieren ---------- */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

/* ---------- Start ---------- */

updateNotifBanner();
render();
checkAndNotify();
