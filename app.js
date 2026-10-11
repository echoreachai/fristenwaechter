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
// Garantie-Ende = Kaufdatum + volle Jahre (Schaltjahre werden durch
// setFullYear korrekt berücksichtigt, anders als eine feste Tageszahl).
function computeGarantieEnde(kaufdatumISO, jahre) {
  const d = parseISO(kaufdatumISO);
  d.setFullYear(d.getFullYear() + (Number(jahre) || 0));
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
    // Schlägt der Start fehl (z. B. offline), beim nächsten Versuch neu laden
    // statt den Fehler bis zum Neustart der App festzuhalten.
    ocrWorkerPromise.catch(() => { ocrWorkerPromise = null; });
  }
  return ocrWorkerPromise;
}

const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.worker.min.mjs";

// PDF-Dateien werden auf manchen Android-Geräten ohne MIME-Typ geliefert
// (file.type leer oder "application/octet-stream") — dann zählt die Endung.
function isPdfFile(file) {
  if (!file) return false;
  if (file.type === "application/pdf") return true;
  return (!file.type || file.type === "application/octet-stream") && /\.pdf$/i.test(file.name || "");
}

// pdf.js wird als ES-Modul geladen und ist erst NACH app.js verfügbar.
// Hier wird darauf gewartet (bzw. notfalls selbst nachgeladen) und der
// Worker-Pfad sicher gesetzt.
let pdfjsPromise = null;
function ensurePdfjs() {
  if (window.pdfjsLib) {
    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    return Promise.resolve(window.pdfjsLib);
  }
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((resolve, reject) => {
      const onReady = () => { clearTimeout(timer); resolve(window.pdfjsLib); };
      window.addEventListener("pdfjs-ready", onReady, { once: true });
      const timer = setTimeout(() => {
        window.removeEventListener("pdfjs-ready", onReady);
        import(PDFJS_URL).then((lib) => { window.pdfjsLib = lib; resolve(lib); }, reject);
      }, 4000);
    }).then((lib) => {
      if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return lib;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

// Liest Text aus einem PDF. Digital erzeugte PDFs (Rechnungen, Bescheide)
// haben fast immer eine Textebene — die wird direkt ausgelesen (schnell,
// exakt). Enthält das PDF kaum Text (z. B. ein eingescanntes Dokument),
// wird die erste Seite stattdessen als Bild gerendert und per OCR gelesen.
async function extractTextFromPdf(file) {
  const pdfjsLib = await ensurePdfjs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const maxPages = Math.min(pdf.numPages, 3);
  let text = "";
  let firstPageLines = [];
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let pageLines = [];
    try {
      pageLines = buildLinesFromPdfTextContent(content, page.getViewport({ scale: 1 }));
    } catch (e) {
      pageLines = [];
    }
    // Zeilenweise (oben -> unten), damit Schlüsselwort und Wert zusammenbleiben
    text += "\n" + (pageLines.length ? pageLines.map((l) => l.text).join("\n") : content.items.map((it) => it.str || "").join(" "));
    if (i === 1) firstPageLines = pageLines;
  }
  if (text.trim().length < 20) {
    // Vermutlich ein gescanntes PDF ohne Textebene -> als Bild rendern und per OCR lesen.
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    // ca. 2200 px Breite (~260 dpi bei A4) — gut lesbar für die Texterkennung
    const viewport = page.getViewport({ scale: Math.min(4, Math.max(2, OCR_TARGET_WIDTH / base.width)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    enhanceCanvasForOcr(canvas);
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(canvas);
    text = (data && data.text) || "";
    return { text, lines: linesFromTesseractData(data) };
  }
  return { text, lines: firstPageLines };
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
    ["einspruchsfrist", "zahlungsfrist", "zahlbar bis", "zahlungsziel", "bis zum", "bis spätestens", "spätestens am", "spätestens bis"],
    ["frist", "fällig", "faellig"],
    ["datum"],
  ],
  rechnung: [
    ["zahlbar bis", "zahlungsziel", "fälligkeitsdatum", "faelligkeitsdatum", "zahlungsfrist", "bis zum", "bis spätestens", "spätestens am", "spätestens bis", "fällig am"],
    ["fällig", "faellig", "frist"],
    ["rechnungsdatum", "datum"],
  ],
  sonstiges: [
    ["frist", "stichtag", "fällig", "faellig", "termin"],
    ["datum"],
  ],
  garantie: [
    ["kaufdatum", "kassenbon", "bondatum", "belegdatum"],
    ["rechnungsdatum", "lieferdatum"],
    ["datum"],
  ],
};

const GERMAN_MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
function parseDateFromText(text, type) {
  const dateRegex = /(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/g;
  // "20. Oktober 2026" -> "20.10.2026"
  text = String(text || "").replace(/(\d{1,2})\.\s*(januar|februar|m(?:ä|ae)rz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+(\d{4})/gi,
    (m, d, mon, y) => `${d}.${GERMAN_MONTHS.indexOf(mon.toLowerCase().replace("ae", "ä")) + 1}.${y}`);
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

// Betragsfeld ist ein Textfeld mit Zahlen-Tastatur (inputmode="decimal").
// type="number" nimmt in manchen iOS-Versionen das deutsche Komma nicht an.
// Akzeptiert: 49,90 · 49.90 · 1.234,56 · 1,234.56 · 49 · "49,90 €"
function parseBetragInput(raw) {
  let s = String(raw || "").replace(/[€\s]/g, "").replace(/eur$/i, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    const parts = s.split(",");
    s = parts.length > 2 ? parts.slice(0, -1).join("") + "." + parts[parts.length - 1] : s.replace(",", ".");
  } else if (lastDot > -1 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100) / 100;
}
function formatBetragInput(num) {
  return Number(num).toFixed(2).replace(".", ",");
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
    /(gesamtbetrag|gesamtsumme|endbetrag|rechnungsbetrag)[^\d]{0,15}(\d{1,3}(?:\.\d{3})*,\d{2})/i,
    /(überweisungsbetrag|ueberweisungsbetrag|zu\s?zahlen(?:der\s?betrag)?|zahlbetrag)[^\d]{0,15}(\d{1,3}(?:\.\d{3})*,\d{2})/i,
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
// Fallback, falls keine Positionsdaten vorliegen: einfach die erste
// plausible Textzeile.
function guessMerchant(text) {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.length < 2 || line.length > 40) continue;
    if (/^[\d.,\-\/\s€]+$/.test(line)) continue;
    return line;
  }
  return null;
}

// Anbieter/Absender/Zahlungsempfänger stehen auf Belegen fast immer im
// Kopfbereich — meist oben rechts (Briefkopf) oder in größerer Schrift
// (Firmenlogo/-name). Diese Funktion bewertet erkannte Textzeilen anhand
// ihrer Position und Schriftgröße (aus OCR-Bounding-Boxen bzw. PDF-Text-
// Transformationen) und wählt die plausibelste Kopfzeile — statt einfach
// nur die erste Zeile im Text zu nehmen.
function isPlausibleHeaderText(text) {
  const t = (text || "").trim();
  if (t.length < 2 || t.length > 60) return false;
  if (/^[\d.,\-\/\s€%:]+$/.test(t)) return false; // rein numerisch/Datum/Betrag
  return true;
}
function scoreHeaderCandidate(line, pageWidth, pageHeight, maxHeight) {
  const sizeScore = maxHeight > 0 ? line.height / maxHeight : 0;
  const verticalFraction = pageHeight > 0 ? line.top / pageHeight : 0;
  const topScore = Math.max(0, 1 - verticalFraction / 0.35); // Bonus für oberste ~35% der Seite
  const rightFraction = pageWidth > 0 ? line.right / pageWidth : 0;
  const rightScore = rightFraction > 0.55 ? 0.3 : 0; // kleiner Bonus für rechtsstehenden Text
  return sizeScore * 1.5 + topScore * 1.2 + rightScore;
}
function guessHeaderCandidate(lines) {
  if (!lines || !lines.length) return null;
  const plausible = lines.filter((l) => isPlausibleHeaderText(l.text));
  if (!plausible.length) return null;
  const pageWidth = Math.max(...lines.map((l) => l.right));
  const pageHeight = Math.max(...lines.map((l) => l.bottom));
  const maxHeight = Math.max(...plausible.map((l) => l.height));
  let best = null;
  let bestScore = -Infinity;
  for (const line of plausible) {
    const score = scoreHeaderCandidate(line, pageWidth, pageHeight, maxHeight);
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  return best ? best.text.trim() : null;
}
// Baut Zeilen mit Position/Größe aus dem pdf.js-Textlayer einer Seite:
// Textfragmente mit ähnlichem y-Wert werden zu einer Zeile zusammengefasst.
function buildLinesFromPdfTextContent(content, viewport) {
  const groups = new Map();
  for (const item of content.items) {
    if (!item.str || !item.str.trim()) continue;
    const fontHeight = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 10;
    const x0 = item.transform[4];
    const y = item.transform[5];
    const width = item.width || item.str.length * fontHeight * 0.5;
    const key = Math.round(y / 3) * 3; // Zeilen mit ähnlichem y zusammenfassen
    if (!groups.has(key)) groups.set(key, { parts: [], y0: y, height: fontHeight });
    const g = groups.get(key);
    g.parts.push({ str: item.str, x0, x1: x0 + width, h: fontHeight });
    g.height = Math.max(g.height, fontHeight);
  }
  const pageHeight = viewport.height;
  // PDF-Koordinaten wachsen nach oben — für unsere top/bottom-Logik umdrehen.
  return Array.from(groups.values()).map((g) => {
    g.parts.sort((a, b) => a.x0 - b.x0);
    let text = "";
    let lastX1 = null;
    for (const p of g.parts) {
      // große Lücke = andere Spalte -> mehrere Leerzeichen als Trenner
      if (lastX1 !== null) text += p.x0 - lastX1 > p.h * 2 ? "   " : " ";
      text += p.str;
      lastX1 = p.x1;
    }
    return {
      text: text.replace(/[ ]{4,}/g, "   ").trim(),
      left: g.parts[0].x0,
      right: Math.max(...g.parts.map((p) => p.x1)),
      top: pageHeight - (g.y0 + g.height),
      bottom: pageHeight - g.y0,
      height: g.height,
    };
  }).sort((a, b) => a.top - b.top);
}
function linesFromTesseractData(data) {
  return ((data && data.lines) || []).map((l) => ({
    text: l.text,
    left: l.bbox.x0,
    right: l.bbox.x1,
    top: l.bbox.y0,
    bottom: l.bbox.y1,
    height: l.bbox.y1 - l.bbox.y0,
  }));
}

/* ---------- Bildaufbereitung für die Texterkennung ----------
   Handyfotos haben oft Schatten und ungleichmäßiges Licht. Vor der
   Erkennung wird das Bild in Graustufen umgerechnet, der Papier-Hintergrund
   herausgerechnet und der Kontrast gestreckt. Das senkt die Fehlerquote bei
   Fotos deutlich (im Test von ca. 80 % auf ca. 23 % falsch gelesene Zeichen). */
// Arbeitet direkt auf ImageData (RGBA). Schritte: Graustufen -> Hintergrund
// (Schatten/ungleichmäßiges Licht) herausrechnen -> Kontrast strecken.
function ocrEnhanceImageData(img, opts) {
  const o = Object.assign({ flatten: true, threshold: false }, opts || {});
  const { data, width: w, height: h } = img;
  const n = w * h;
  const gray = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) gray[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  let out = gray;
  if (o.flatten) {
    // Hintergrund schätzen: Blockmaximum (Papier ist hell, Schrift dunkel),
    // dann glätten und hochskalieren; Pixel durch Hintergrund teilen.
    const bs = Math.max(8, Math.round(Math.min(w, h) / 60));
    const bw = Math.ceil(w / bs), bh = Math.ceil(h / bs);
    let bg = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let mx = 0;
      const y1 = Math.min(h, (by + 1) * bs), x1 = Math.min(w, (bx + 1) * bs);
      for (let y = by * bs; y < y1; y += 2) { const row = y * w; for (let x = bx * bs; x < x1; x += 2) { const v = gray[row + x]; if (v > mx) mx = v; } }
      bg[by * bw + bx] = mx;
    }
    // 3x Boxfilter 3x3 auf der kleinen Karte
    for (let pass = 0; pass < 3; pass++) {
      const nb = new Float32Array(bw * bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        let s = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= bh) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= bw) continue; s += bg[yy * bw + xx]; c++; } }
        nb[y * bw + x] = s / c;
      }
      bg = nb;
    }
    out = new Uint8ClampedArray(n);
    for (let y = 0; y < h; y++) {
      const fy = Math.min(bh - 1.001, Math.max(0, y / bs - 0.5)); const y0 = Math.floor(fy), ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = Math.min(bw - 1.001, Math.max(0, x / bs - 0.5)); const x0 = Math.floor(fx), tx = fx - x0;
        const i0 = y0 * bw + x0;
        const b = (bg[i0] * (1 - tx) + bg[i0 + 1 < bw * bh ? i0 + 1 : i0] * tx) * (1 - ty) +
                  (bg[Math.min(i0 + bw, bw * bh - 1)] * (1 - tx) + bg[Math.min(i0 + bw + 1, bw * bh - 1)] * tx) * ty;
        out[y * w + x] = b > 8 ? Math.min(255, (gray[y * w + x] * 255) / b) : gray[y * w + x];
      }
    }
  }
  // Kontrast strecken: dunkelstes 1 % -> Schwarz, Papier -> Weiß
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[out[i]]++;
  let lo = 0, acc = 0; const target = n * 0.01;
  for (; lo < 255 && acc + hist[lo] < target; lo++) acc += hist[lo];
  let hi = 255; acc = 0; const targetHi = n * 0.05;
  for (; hi > lo + 1 && acc + hist[hi] < targetHi; hi--) acc += hist[hi];
  const range = Math.max(30, hi - lo);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    let v = ((out[i] - lo) * 255) / range;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    if (o.threshold) v = v < 160 ? 0 : 255;
    data[j] = data[j + 1] = data[j + 2] = v; data[j + 3] = 255;
  }
  return img;
}

/* ---------- Anbieter / Zahlungsempfänger erkennen ----------
   In Briefen ist der Absender oft nicht eindeutig gekennzeichnet. Statt nur
   die größte Zeile im Kopf zu nehmen, sammelt detectProvider() Hinweise aus
   mehreren Quellen und vergibt Punkte:
     - Kennzeichnung „Absender/Rechnungssteller/Verkäufer“           (stark)
     - Rücksendezeile über dem Adressfeld (DIN 5008, „Firma · Str · PLZ“) (stark)
     - „Zahlungsempfänger/Kontoinhaber/Begünstigter“                (stark)
     - Firmenname mit Rechtsform (GmbH, AG, SE, e.V. …)             (mittel)
     - Behörden/Einrichtungen (Stadt …, Stadtwerke, Kasse …)        (mittel)
     - größte Zeile im Briefkopf                                    (schwach)
     - Internet-/E-Mail-Domain                                       (schwach)
   Gleiche Namen aus mehreren Quellen addieren ihre Punkte. Ist der Anbieter
   nirgends gut gekennzeichnet, gewinnt damit automatisch der
   Zahlungsempfänger. Eigene Adresse (Absenderdaten) und das Empfänger-
   Adressfeld („Herrn …“) werden ausgeschlossen. */

const PROVIDER_LEGAL_RE = /(?:^|[\s,(])(GmbH\s*&\s*Co\.?\s*KGaA|GmbH\s*&\s*Co\.?\s*KG|gGmbH|GmbH|mbH|AG|KGaA|KG|OHG|UG(?:\s*\(haftungsbeschränkt\))?|GbR|e\.\s?V\.?|e\.\s?K\.?|eG|SE|PartG(?:\s*mbB)?|Ltd\.?|Inc\.?|AB|B\.V\.|S\.A\.|S\.à\s?r\.l\.)(?=$|[\s,.;:·|)\-–])/;
const PROVIDER_AUTHORITY_RE = /\b(stadt|landeshauptstadt|gemeinde|landkreis|kreis|kreisverwaltung|bezirksamt|ordnungsamt|bu(?:ß|ss)geldstelle|polizei\w*|finanzamt|landratsamt|stadtkasse|kreiskasse|amtskasse|stadtwerke|stadtverwaltung|beitragsservice|krankenkasse|aok|barmer|versicherung\w*|verkehrsbetriebe|hausverwaltung|immobilien\w*|wohnungsbau\w*|rechtsanw(?:ä|ae)lt\w*|kanzlei|inkasso\w*|zahnarzt\w*|arztpraxis|praxis|klinik\w*|klinikum|universität|hochschule|verein|verband|genossenschaft|energie\w*|telekom|vodafone|fitness\w*)\b/i;
const PROVIDER_NOISE_RE = /(iban|\bbic\b|swift|bankverbindung|kreditinstitut|konto-?n(?:umme)?r|\bblz\b|ust\.?-?id|umsatzsteuer|steuer-?n(?:umme)?r|\bhrb\b|\bhra\b|registergericht|amtsgericht|handelsregister|gesch(?:ä|ae)ftsf(?:ü|ue)hr|vorstand|aufsichtsrat|\bsitz\b|telefon|\btel\b|\bfax\b|e-?mail|www\.|https?:|seite\s*\d|\bdatum\b|kunden-?n(?:umme)?r|rechnungs-?n(?:umme)?r|aktenzeichen|gl(?:ä|ae)ubiger-?id|mandatsreferenz|verwendungszweck|betrag|\bsumme\b|\beur\b|€|\d{1,2}\.\d{1,2}\.\d{2,4}|postfach|(?:ö|oe)ffnungszeiten|servicezeit|hotline|bestellnummer|vertragsnummer)/i;
const PROVIDER_GENERIC_START_RE = /^(ihre?|unsere?|neue|letzte|erste|zweite|dritte|\d\.)?\s*(rechnung\w*|\w*rechnung|gutschrift|mahnung|zahlungserinnerung|erinnerung|bu(?:ß|ss)geldbescheid|anh(?:ö|oe)rung\w*|verwarnung\w*|zeugenfragebogen|\w*bescheid|k(?:ü|ue)ndigung\w*|auftragsbest(?:ä|ae)tigung|bestellbest(?:ä|ae)tigung|lieferschein|quittung|kassenbon|beleg|vertrag\w*|\w*abrechnung|mitgliedsbeitrag|beitrag|zahlungsaufforderung|information|mitteilung|hinweis|wichtig|original|kopie|duplikat|herrn?|frau|familie|firma|an|betreff|seite|summe|gesamt|netto|brutto|mwst|ust|datum|kundennummer|absender|empf(?:ä|ae)nger|team)\b/i;
const PROVIDER_ALWAYS_GENERIC_RE = /^(sehr geehrte|guten tag|hallo|liebe[rs]?\b|mit freundlichen|freundliche gr|viele gr|vielen dank|ihr[e]?\s|unser[e]?\s|bitte\b|wir\b|sie\b)/i;
const PROVIDER_STREET_RE = /\b\S*(stra(?:ß|ss)e|str\.|weg|platz|allee|gasse|ring|damm|ufer|chaussee|markt)\s*\d/i;
const PAYMENT_SERVICE_RE = /(paypal|klarna|riverty|afterpay|ratepay|unzer|computop|billpay|stripe|adyen|mollie|amazon payments|payone|heidelpay|easycredit|creditplus)/i;
const FREEMAIL_RE = /^(gmail|googlemail|gmx|web|t-online|outlook|hotmail|live|yahoo|icloud|me|aol|freenet|posteo|mailbox|protonmail|arcor|online)$/i;

function providerKey(name) {
  return (name || "")
    .toLowerCase()
    .replace(PROVIDER_LEGAL_RE, " ")
    .replace(/[^a-z0-9äöüß ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function providerSimilar(a, b) {
  const ka = providerKey(a), kb = providerKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const [s, l] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (s.length >= 4 && (l.startsWith(s + " ") || l.endsWith(" " + s) || l.includes(" " + s + " "))) return true;
  if (s.length >= 8) {
    // OCR-Lesefehler tolerieren (z. B. "Stachwerke" statt "Stadtwerke")
    const m = s.length, n = l.length;
    if (Math.abs(m - n) <= 3) {
      let prev = Array.from({ length: n + 1 }, (_, i) => i);
      for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === l[j - 1] ? 0 : 1));
        prev = cur;
      }
      if (prev[n] / n <= 0.2) return true;
    }
  }
  return false;
}

// Bereinigt einen Namenskandidaten; gibt null zurück, wenn nichts Brauchbares übrig bleibt.
function cleanProviderName(raw, opts) {
  const o = opts || {};
  let s = (raw || "").replace(/[ \t]+/g, " ").trim();
  s = s.replace(/^[\s"'„“”‚‘’•·*\-–—|:;,.]+/, "");
  // hinter dem Namen folgende Kontodaten/Kontakte/Adresse abschneiden
  s = s.split(/\s+(?:IBAN\b|BIC\b|Konto(?:nummer|-?nr\.?)?\s*:|Bankverbindung|Bank\s*:|Kreditinstitut|Tel\.|Telefon|Fax\b|E-?Mail|www\.)/i)[0];
  s = s.split(/\s[·•|]\s|\s[-–—]\s|\s{3,}/)[0];
  s = s.replace(/,\s*(?:\d{5}\b|[^,]*\b(?:stra(?:ß|ss)e|str\.|weg|platz|allee|gasse|postfach)\b).*$/i, "");
  // Name endet nach der Rechtsform (Rest ist meist Adresse/Ort)
  const legal = PROVIDER_LEGAL_RE.exec(s);
  if (legal) s = s.slice(0, legal.index + legal[0].length);
  s = s.replace(/\s+/g, " ").trim();
  if (!/\b[eE]\.\s?[VKG]\.$|Co\.$|Inc\.$|Ltd\.$|r\.l\.$|S\.A\.$|B\.V\.$/.test(s)) s = s.replace(/[\s:;,.\-–—·|]+$/, "");
  if (s.length < 2) return null;
  if (s.length > 60) s = s.slice(0, 55).replace(/\s+\S*$/, "");
  const nonSpace = s.replace(/\s/g, "");
  const letters = (nonSpace.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
  if (letters < 2 || letters / nonSpace.length < 0.6) return null;
  const words = s.split(" ");
  // OCR-Müll wie "SO nn" oder "been" aussortieren: mind. ein echtes Wort
  const hasRealWord = words.some((w) => /^[A-ZÄÖÜ0-9][A-Za-zÄÖÜäöüß0-9&\-.]{2,}$/.test(w) || /^[a-zäöü]{4,}$/.test(w) && o.allowLower);
  if (!hasRealWord && !PROVIDER_LEGAL_RE.test(s)) return null;
  if (PROVIDER_ALWAYS_GENERIC_RE.test(s)) return null;
  if (PROVIDER_GENERIC_START_RE.test(s) && (words.length <= 3 || /\d|\bnr\b|\bvom\b|\bfür\b/i.test(s))) return null;
  if (PROVIDER_STREET_RE.test(s) || /^\d{5}\b/.test(s) || /^postfach\b/i.test(s)) return null;
  if (o.senderKey && providerSimilar(s, o.senderKey)) return null;
  return s;
}

function detectProvider(text, lines, type, sender) {
  const senderName = sender && sender.name ? String(sender.name) : "";
  const senderStreet = sender && sender.strasse ? String(sender.strasse).toLowerCase() : "";
  const cleanOpts = { senderKey: senderName };
  const textLines = (text || "").split("\n").map((l) => l.trim()).filter(Boolean);

  // Zeilen mit Lage auf der Seite (aus OCR/PDF); ohne Positionsdaten wird die
  // Reihenfolge im Text als grobe Lage verwendet.
  let items;
  if (lines && lines.length >= 3) {
    const pageH = Math.max(...lines.map((l) => l.bottom)) || 1;
    const heights = lines.map((l) => l.height).filter((h) => h > 0).sort((a, b) => a - b);
    const medH = heights[Math.floor(heights.length / 2)] || 1;
    items = lines
      .filter((l) => l.text && l.text.trim())
      .sort((a, b) => a.top - b.top)
      .map((l) => ({ text: l.text.trim(), top: l.top / pageH, size: l.height / medH }));
  } else {
    items = textLines.map((t, i) => ({ text: t, top: textLines.length > 1 ? i / (textLines.length - 1) : 0, size: 1 }));
  }

  // Empfänger-Adressfeld („Herrn/Frau …“ + 3 Folgezeilen) und eigene Adresse ausschließen
  const excluded = new Set();
  items.forEach((it, i) => {
    if (/^(herrn?|frau|familie|eheleute)\b\.?/i.test(it.text) && !/[·•|]/.test(it.text)) {
      for (let k = i; k <= Math.min(i + 3, items.length - 1); k++) excluded.add(k);
    }
    if (senderName && providerSimilar(it.text, senderName)) excluded.add(i);
    if (senderStreet && it.text.toLowerCase().includes(senderStreet)) excluded.add(i);
  });

  const cands = [];
  const add = (name, source, score, extra) => {
    const clean = cleanProviderName(name, Object.assign({}, cleanOpts, extra && extra.cleanOpts));
    if (!clean) return;
    cands.push(Object.assign({ name: clean, source, score, recipient: false }, extra || {}));
  };

  // 1) Kennzeichnungen im Text (über alle Seiten); Wert notfalls aus der Folgezeile
  const LABELS = [
    { re: /(?:^|[^a-zäöüß])(absender|rechnungssteller\w*|verk(?:ä|ae)ufer\w*|anbieter|h(?:ä|ae)ndler|auftragnehmer|leistungserbringer|rechnung\s+von|verkauft\s+(?:von|durch))\b\s*(?:\([^)]*\))?\s*[:：]?\s*(.*)$/i, source: "label-anbieter", score: 7, recipient: false },
    { re: /(?:^|[^a-zäöüß])(zahlungsempf(?:ä|ae)nger\w*|kontoinhaber\w*|beg(?:ü|ue)nstigte[rn]?|empf(?:ä|ae)nger\s+der\s+zahlung|zahlung\s+an)\b\s*(?:\([^)]*\))?\s*[:：]?\s*(.*)$/i, source: "label-zahlung", score: 6, recipient: true },
    { re: /(?:(?:ü|ue)berweisen|zahlen)\s+sie\s+(?:bitte\s+)?(?:den\s+\w*betrag\s+)?(?:bis\s+(?:zum\s+)?\S+\s+)?(an)\s*[:]?\s*(.+)$/i, source: "label-zahlung", score: 5, recipient: true },
  ];
  if (type !== "retoure" && type !== "garantie") {
    LABELS.push({ re: /(?:^|[^a-zäöüß])(empf(?:ä|ae)nger)\b\s*[:：]\s*(.*)$/i, source: "label-empfaenger", score: 3.5, recipient: true });
  }
  textLines.forEach((line, i) => {
    for (const lab of LABELS) {
      const m = lab.re.exec(line);
      if (!m) continue;
      if (lab.source === "label-empfaenger" && /zahlungsempf/i.test(line)) continue;
      let val = (m[2] || "").trim();
      if (/^(unser|folgend|das|die|den|uns\b|sie\b)/i.test(val)) val = "";
      if (val.replace(/[^A-Za-zÄÖÜäöüß]/g, "").length < 2 && textLines[i + 1]) val = textLines[i + 1];
      add(val, lab.source, lab.score, { recipient: lab.recipient, order: i });
      break;
    }
  });

  // 2) Rücksendezeile über dem Adressfeld: „Firma · Straße/Postfach · PLZ Ort“
  items.forEach((it, i) => {
    if (it.top > 0.45 || excluded.has(i)) return;
    if (!/\b\d{5}\b/.test(it.text)) return;
    if (!/\s[·•|]\s|\s[-–—]\s|\s·|·\s/.test(it.text)) return;
    const first = it.text.split(/\s*[·•|]\s*|\s[-–—]\s/)[0];
    add(first, "ruecksendezeile", 7);
  });

  // 3) Firmennamen mit Rechtsform / Behörden – zeilenweise, in Segmente zerlegt
  items.forEach((it, i) => {
    if (excluded.has(i)) return;
    const segments = it.text.split(/\s[·•|]\s|\s[-–—]\s|\s{3,}/);
    segments.forEach((seg, si) => {
      const segTrim = seg.trim();
      if (!segTrim || PROVIDER_NOISE_RE.test(segTrim) && !(si === 0 && PROVIDER_LEGAL_RE.test(segTrim))) return;
      let pos = 0;
      if (it.top < 0.3) pos += 1.5;
      else if (it.top > 0.85) pos += 0.5;
      if (it.size >= 1.4) pos += 1;
      if (PROVIDER_LEGAL_RE.test(segTrim)) add(segTrim, "rechtsform", 4 + pos);
      else if (PROVIDER_AUTHORITY_RE.test(segTrim) && segTrim.split(/\s+/).length >= 2) add(segTrim, "einrichtung", 3 + pos);
    });
  });

  // 4) Größte/auffälligste Zeile im Briefkopf (bisherige Logik, mit Filtern)
  if (lines && lines.length >= 3) {
    const filtered = lines.filter((l, idx) => {
      const c = cleanProviderName(l.text, cleanOpts);
      return c && !PROVIDER_NOISE_RE.test(l.text) && !excluded.has(items.findIndex((it) => it.text === l.text.trim()));
    });
    const head = guessHeaderCandidate(filtered);
    if (head) add(head, "briefkopf", 3, { cleanOpts: { allowLower: true } });
  }

  // 5) Domain aus Internet-/E-Mail-Adresse (z. B. www.stadtwerke-krefeld.de)
  const dm = /(?:www\.|@)([a-z0-9][a-z0-9-]{1,40})\.(?:de|com|net|org|eu|at|ch|info|biz)\b/i.exec(text || "");
  if (dm && !FREEMAIL_RE.test(dm[1])) {
    const label = dm[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    add(label, "domain", 2, { cleanOpts: { allowLower: true } });
  }

  // 6) Notlösung: erste brauchbare Textzeile
  for (let i = 0; i < items.length; i++) {
    if (excluded.has(i) || PROVIDER_NOISE_RE.test(items[i].text)) continue;
    const c = cleanProviderName(items[i].text, cleanOpts);
    if (c) { add(c, "erste-zeile", 1); break; }
  }

  if (!cands.length) return { provider: null, recipient: null, score: 0, candidates: [] };

  // Gleiche Namen gruppieren und Punkte addieren (pro Quelle zählt der beste
  // Treffer voll, jede Wiederholung gibt einen kleinen Bonus)
  const groups = [];
  for (const c of cands) {
    let g = groups.find((gr) => gr.members.some((m) => providerSimilar(m.name, c.name)));
    if (!g) { g = { members: [] }; groups.push(g); }
    g.members.push(c);
  }
  for (const g of groups) {
    const bySource = {};
    for (const m of g.members) (bySource[m.source] ||= []).push(m.score);
    let score = 0;
    for (const arr of Object.values(bySource)) {
      arr.sort((a, b) => b - a);
      score += arr[0] + Math.min(2, (arr.length - 1) * 1);
    }
    const sample = g.members.map((m) => m.name).join(" ");
    if (PAYMENT_SERVICE_RE.test(sample)) score *= 0.4; // Zahlungsdienstleister ist selten der eigentliche Anbieter
    g.score = score;
    // Anzeigename: bevorzugt mit Rechtsform, dann die häufigste Schreibweise,
    // dann der Treffer mit den meisten Einzelpunkten
    const counts = {};
    for (const m of g.members) counts[m.name] = (counts[m.name] || 0) + 1;
    g.name = g.members.slice().sort((a, b) => {
      const la = PROVIDER_LEGAL_RE.test(a.name) ? 1 : 0, lb = PROVIDER_LEGAL_RE.test(b.name) ? 1 : 0;
      if (la !== lb) return lb - la;
      const ta = /^label|ruecksende/.test(a.source) ? 1 : 0, tb = /^label|ruecksende/.test(b.source) ? 1 : 0;
      if (ta !== tb) return tb - ta;
      if (counts[a.name] !== counts[b.name]) return counts[b.name] - counts[a.name];
      return b.score - a.score;
    })[0].name;
  }
  groups.sort((a, b) => b.score - a.score);
  const best = groups[0];

  // Zahlungsempfänger: ausdrücklich gekennzeichneter Name, sonst Anbieter
  const recCands = cands.filter((c) => c.recipient).sort((a, b) => b.score - a.score || a.order - b.order);
  let recipient = null;
  if (recCands.length) {
    const rg = groups.find((g) => g.members.includes(recCands[0]));
    recipient = rg ? rg.name : recCands[0].name;
  }
  return {
    provider: best.score >= 1 ? best.name : null,
    recipient,
    score: best.score,
    candidates: groups.map((g) => ({ name: g.name, score: Math.round(g.score * 10) / 10, sources: [...new Set(g.members.map((m) => m.source))] })),
  };
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
  const ibanRegex = /\b([A-Z]{2}[ ]?[\dO]{2}(?:[ ]?[A-Z0-9|]){10,30})\b/g;
  const candidates = [];
  let m;
  while ((m = ibanRegex.exec(compact))) {
    const clean = m[1].replace(/\s+/g, "").toUpperCase();
    if (clean.length >= 15 && clean.length <= 34) candidates.push(clean);
  }
  if (candidates.length === 0) return null;
  const ocrFix = (c) => c.slice(0, 2) + c.slice(2).replace(/O/g, "0").replace(/[IL|]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");
  // Feste IBAN-Längen je Land: verhindert, dass angehängter Text ("BIC …")
  // zufällig die Prüfsumme erfüllt
  const IBAN_LENGTHS = { DE: 22, AT: 20, CH: 21, LI: 21, NL: 18, BE: 16, LU: 20, FR: 27, IT: 27, ES: 24, IE: 22, GB: 22, DK: 18, PL: 28, CZ: 24, SE: 24 };
  for (const raw of candidates) {
    const known = IBAN_LENGTHS[raw.slice(0, 2)];
    // Deutsche IBANs bestehen nach "DE" nur aus Ziffern -> typische OCR-Verwechslungen korrigieren
    const variants = raw.startsWith("DE") ? [raw, ocrFix(raw)] : [raw];
    for (const candidate of variants) {
      if (known) {
        const trimmed = candidate.slice(0, known);
        if (trimmed.length === known && (!raw.startsWith("DE") || /^DE\d{20}$/.test(trimmed)) && ibanChecksumValid(trimmed)) return trimmed;
        continue;
      }
      for (let len = candidate.length; len >= 15; len--) {
        const trimmed = candidate.slice(0, len);
        if (ibanChecksumValid(trimmed)) return trimmed;
      }
    }
  }
  return candidates[0].slice(0, 22); // Fallback ohne Prüfsummentreffer (z. B. bei Lesefehlern)
}

// Typabhängige Referenznummer-Erkennung: sucht in der Nähe passender
// Schlüsselwörter nach einem Code (Kundennummer, Rechnungsnummer,
// Aktenzeichen …). Kein Treffer ist besser als ein falscher — daher recht
// enge Muster statt "irgendeine Zahl im Text".
const REFERENCE_KEYWORDS_BY_TYPE = {
  rechnung: ["rechnungsnummer", "rechnungs-nr", "rechnungsnr", "rechnung\\s*nr\\.?", "rg-nr", "belegnummer", "beleg-nr", "verwendungszweck", "referenznummer", "kundennummer", "kd-nr", "kdnr"],
  abo: ["kundennummer", "kd-nr", "kdnr", "vertragsnummer", "mitgliedsnummer", "mitgliedsnr"],
  strafzettel: ["aktenzeichen", "bescheidnummer", "geschäftszeichen", "geschaeftszeichen", "vorgangsnummer"],
};
function parseReferenceFromText(text, type) {
  const keywords = REFERENCE_KEYWORDS_BY_TYPE[type];
  if (!keywords) return null;
  const keywordRegex = new RegExp(`(?:${keywords.join("|")})[:.#\\s]*([A-Za-zÄÖÜäöü0-9][A-Za-zÄÖÜäöü0-9\\-\\/\\.]{2,24})`, "i");
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
  sonstiges: { label: "Sonstiges" },
  garantie: { label: "Garantie" },
};

// Sicherheit: Einträge aus einer importierten Backup-Datei kommen von
// außen (die Datei könnte manipuliert oder von einer fremden Quelle sein).
// Statt die Felder ungeprüft zu übernehmen, wird hier jeder Eintrag auf
// eine feste, bekannte Form zurechtgestutzt — unbekannte/zusätzliche
// Felder fallen weg, Strings werden gekappt, der Typ wird gegen die
// Whitelist oben geprüft.
function sanitizeImportedEntry(raw) {
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max || 500) : "");
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  const type = Object.keys(TYPE_META).includes(raw.type) ? raw.type : "retoure";
  let beleg = null;
  if (raw.beleg && typeof raw.beleg === "object") {
    const validUrl = (v) => typeof v === "string" && /^data:(application\/pdf|image\/(png|jpe?g|webp|gif));base64,/.test(v);
    const dataUrl = validUrl(raw.beleg.dataUrl) ? raw.beleg.dataUrl : null;
    const pages = Array.isArray(raw.beleg.pages) ? raw.beleg.pages.filter(validUrl).slice(0, 20) : null;
    beleg = {
      name: str(raw.beleg.name, 200) || "Beleg",
      mime: raw.beleg.mime === "application/pdf" ? "application/pdf" : "image/jpeg",
      dataUrl: (pages && pages[0]) || dataUrl,
    };
    if (pages && pages.length) beleg.pages = pages;
  }
  return {
    id: str(raw.id, 100) || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    produkt: str(raw.produkt, 200) || "Ohne Titel",
    erhalten: str(raw.erhalten, 10),
    kaufdatum: str(raw.kaufdatum, 10) || null,
    garantieJahre: (typeof raw.garantieJahre === "number" && raw.garantieJahre >= 0 && raw.garantieJahre <= 30) ? raw.garantieJahre : null,
    deadline: str(raw.deadline, 10) || toISO(new Date()),
    betrag: num(raw.betrag),
    notiz: str(raw.notiz, 1000),
    referenz: str(raw.referenz, 100),
    adresse: str(raw.adresse, 500),
    empfaenger: str(raw.empfaenger, 200),
    iban: str(raw.iban, 40),
    beleg,
    status: raw.status === "erledigt" ? "erledigt" : "aktiv",
    createdAt: str(raw.createdAt, 40) || new Date().toISOString(),
  };
}

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
let searchQuery = "";
let sortMode = "deadline-asc";
let currentBeleg = null;

/* ---------- Bild-Verkleinerung ---------- */

// Lädt ein Foto in ein Canvas mit OCR-tauglicher Auflösung (1600–2200 px
// Breite: kleine Bilder werden vergrößert, riesige verkleinert) und bereitet
// es für die Texterkennung auf.
const OCR_TARGET_WIDTH = 2200;
const OCR_MIN_WIDTH = 1600;
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function enhanceCanvasForOcr(canvas) {
  try {
    const ctx = canvas.getContext("2d");
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ocrEnhanceImageData(id);
    ctx.putImageData(id, 0, 0);
  } catch (e) {
    console.warn("Bildaufbereitung übersprungen:", e);
  }
  return canvas;
}
async function prepareImageForOcr(file) {
  const img = await loadImageFromFile(file);
  let w = Math.min(img.width, OCR_TARGET_WIDTH);
  if (w < OCR_MIN_WIDTH) w = Math.min(OCR_MIN_WIDTH, img.width * 3);
  const scale = w / img.width;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return enhanceCanvasForOcr(canvas);
}

// Typische OCR-Verwechslungen in Zahlen glätten ("84,9O" -> "84,90",
// "84, 90" -> "84,90"), ohne normalen Text zu verändern.
function normalizeOcrText(text) {
  let t = String(text || "");
  for (let k = 0; k < 2; k++) {
    t = t.replace(/(\d[.,]?)[Oo](?=[\d.,\s€]|$)/gm, (m, a) => a + "0");
    t = t.replace(/([.,])[Oo](\d)/g, (m, a, b) => a + "0" + b);
  }
  t = t.replace(/(\d),\s(\d{2})(?!\d)/g, "$1,$2");
  return t;
}

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
const statGarantie = $("#stat-garantie");
const statGarantieBtn = $("#stat-garantie-btn");
const garantieOverlay = $("#garantie-overlay");
const garantieList = $("#garantie-list");
const errorBox = $("#fw-error");

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = "block";
  setTimeout(() => { errorBox.style.display = "none"; }, 5000);
}

function sortEntries(list, mode) {
  const sorted = list.slice();
  if (mode === "deadline-desc") {
    sorted.sort((a, b) => parseISO(b.deadline) - parseISO(a.deadline));
  } else if (mode === "created-desc") {
    sorted.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  } else if (mode === "alpha") {
    sorted.sort((a, b) => a.produkt.localeCompare(b.produkt, "de", { sensitivity: "base" }));
  } else {
    // deadline-asc (Standard): offene Einträge zuerst nach Frist, erledigte ans Ende
    sorted.sort((a, b) => {
      if (a.status !== b.status) return a.status === "erledigt" ? 1 : -1;
      return parseISO(a.deadline) - parseISO(b.deadline);
    });
  }
  return sorted;
}

function render() {
  // Garantien laufen als eigener Bereich (Garantie-Archiv) getrennt von
  // den übrigen Fristen — sie tauchen weder in der Hauptliste noch in den
  // Dringend/Bald/Aktiv/Gesamt-Zahlen oben auf.
  const fristEntries = entries.filter((e) => e.type !== "garantie");
  const garantieEntries = entries.filter((e) => e.type === "garantie");

  const active = fristEntries.filter((e) => e.status !== "erledigt");
  const dringend = active.filter((e) => ["dringend", "abgelaufen"].includes(statusOf(e)));
  const bald = active.filter((e) => statusOf(e) === "bald");

  statDringend.textContent = dringend.length;
  statBald.textContent = bald.length;
  statAktiv.textContent = active.length;
  statGesamt.textContent = fristEntries.length;

  const activeGarantien = garantieEntries.filter((e) => e.status !== "erledigt");
  const garantienBaldFaellig = activeGarantien.some((e) => ["dringend", "bald", "abgelaufen"].includes(statusOf(e)));
  statGarantie.textContent = activeGarantien.length;
  statGarantie.style.color = garantienBaldFaellig ? "var(--amber)" : "var(--ink)";

  const query = searchQuery.trim().toLowerCase();
  let visible = fristEntries.filter((e) => {
    if (filter === "aktiv") return e.status !== "erledigt";
    if (filter === "erledigt") return e.status === "erledigt";
    return true;
  });
  if (query) {
    visible = visible.filter((e) => {
      const haystack = [e.produkt, e.notiz, e.referenz].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }
  visible = sortEntries(visible, sortMode);

  listEl.innerHTML = "";
  if (visible.length === 0) {
    listEl.innerHTML = fristEntries.length === 0
      ? `<div class="fw-empty">
          <div class="fw-empty-title">Noch nichts eingetragen</div>
          <p>Trage eine Bestellung oder ein Abo ein — die Frist wird automatisch berechnet.</p>
        </div>`
      : `<div class="fw-empty">
          <div class="fw-empty-title">Keine Treffer</div>
          <p>Keine Einträge passen zur aktuellen Suche/Filterung.</p>
        </div>`;
    return;
  }
  visible.forEach((entry) => listEl.appendChild(renderCard(entry)));
  if (garantieOverlay.style.display === "flex") renderGarantieArchiv();
}

function stampSVG(status, dleft) {
  const meta = STATUS_META[status];
  let big = "", small = "";
  if (status === "erledigt") { big = "OK"; small = "ERLEDIGT"; }
  else if (status === "abgelaufen") { big = String(Math.abs(dleft)); small = "TAGE ÜBERFÄLLIG"; }
  else if (dleft > 365) {
    // Lange Laufzeiten (v. a. Garantien) in Monaten, damit die Zahl in den Stempel passt.
    const months = Math.floor(dleft / 30.44);
    big = String(months); small = "MONATE ÜBRIG";
  }
  else { big = String(dleft); small = dleft === 1 ? "TAG ÜBRIG" : "TAGE ÜBRIG"; }
  const fontSize = big.length > 3 ? 16 : big.length > 2 ? 20 : 26;
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
  else if (entry.type === "sonstiges") base = `Frist/Stichtag: ${formatDate(entry.deadline)}`;
  else if (entry.type === "garantie") base = `${entry.kaufdatum ? `Gekauft: ${formatDate(entry.kaufdatum)} · ` : ""}Garantie bis: ${formatDate(entry.deadline)}`;
  else base = `Fristende: ${formatDate(entry.deadline)}`;
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
  // Sicherheit: entry.type kommt bei importierten Backups potenziell von
  // außen. Nie den Rohwert ins HTML einsetzen — nur über die feste
  // TYPE_META-Liste auflösen, sonst neutralen Text anzeigen.
  const typeLabel = TYPE_META[entry.type] ? TYPE_META[entry.type].label : "Eintrag";

  const card = document.createElement("div");
  card.className = `fw-card ${isErledigt ? "is-erledigt" : ""}`;
  card.innerHTML = `
    ${stampSVG(status, dleft)}
    <div class="fw-card-body">
      <div class="fw-card-top">
        <span class="fw-type-badge"></span>
        <span class="fw-type-badge" style="color:${meta.color};border-color:${meta.color}">${meta.label}</span>
      </div>
      <div class="fw-title-row">
        <p class="fw-produkt ${isErledigt ? "strike" : ""}"></p>
        ${entry.betrag !== null && entry.betrag !== undefined && entry.betrag !== "" ? `<p class="fw-amount"></p>` : ""}
      </div>
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
  card.querySelector(".fw-type-badge").textContent = typeLabel;
  // Texte per textContent setzen (XSS-sicher bei Nutzereingaben)
  card.querySelector(".fw-produkt").textContent = entry.produkt;
  const amountEl = card.querySelector(".fw-amount");
  if (amountEl) amountEl.textContent = formatEuro(Number(entry.betrag));
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
  if (compareBtn) compareBtn.addEventListener("click", () => openComparePopup(entry));
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

const searchInput = $("#search-input");
const sortSelect = $("#sort-select");
searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value;
  render();
});
sortSelect.addEventListener("change", () => {
  sortMode = sortSelect.value;
  render();
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
  sonstiges: { field: $("#field-sonstiges"), input: $("#input-sonstiges") },
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
const fieldGarantie = $("#field-garantie");
const formTitle = $("#fw-form-title");
const fieldArt = $("#field-art");
const kaufdatumInput = $("#input-kaufdatum");
const garantiedauerInput = $("#input-garantiedauer");
const fileInput = $("#input-file");
const previewLine = $("#preview-line");
const fileRow = $("#file-row");
const fileError = $("#file-error");
const fileAddPageInput = $("#input-file-addpage");
const fileAddPageCameraInput = $("#input-file-addpage-camera");
const pageThumbs = $("#page-thumbs");
const btnAddPage = $("#btn-add-page");
const ocrStatus = $("#ocr-status");
const ocrSpinner = $("#ocr-spinner");
const ocrStatusText = $("#ocr-status-text");
const saveBtn = $("#btn-save");

let currentType = "retoure";
let currentBelegDraft = null;
let currentBelegPages = []; // mehrere Foto-Seiten desselben Belegs (nur bei Fotos, nicht bei PDF)
// Verhindert, dass eine spät eintreffende OCR-Vermutung ein Feld
// überschreibt, das der Mensch inzwischen selbst bearbeitet hat.
let dateTouched = false;
let betragTouched = false;
let produktTouched = false;
let referenzTouched = false;
let ibanTouched = false;
let empfaengerTouched = false;
// Getrennt von "Touched": merkt sich, ob ein Feld schon durch die
// Texterkennung EINER vorherigen Seite gefüllt wurde, damit eine weitere
// Seite Lücken auffüllt statt einen bereits guten Treffer zu überschreiben.
let dateAutoFilled = false;
let betragAutoFilled = false;
let produktAutoFilled = false;
let produktAutoScore = 0;
let referenzAutoFilled = false;
let ibanAutoFilled = false;
let empfaengerAutoFilled = false;

const REFERENZ_LABELS = {
  abo: { label: "Kundennummer (optional)", hint: "Wird, falls angegeben, im Kündigungsschreiben genannt." },
  strafzettel: { label: "Aktenzeichen / Bescheidnummer (optional)", hint: "Wird, falls angegeben, im Einspruchsschreiben genannt." },
  rechnung: { label: "Rechnungs-/Verwendungszweck-Nummer (optional)", hint: "Praktisch als Verwendungszweck bei der Überweisung." },
  sonstiges: { label: "Referenz/Nummer (optional)", hint: "Beliebige Notiznummer, falls hilfreich." },
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
  fieldGarantie.style.display = type === "garantie" ? "block" : "none";
}

function openModal(presetType) {
  currentType = presetType || "retoure";
  currentBelegDraft = null;
  currentBelegPages = [];
  dateTouched = false;
  betragTouched = false;
  produktTouched = false;
  referenzTouched = false;
  ibanTouched = false;
  empfaengerTouched = false;
  dateAutoFilled = false;
  betragAutoFilled = false;
  produktAutoFilled = false;
  produktAutoScore = 0;
  referenzAutoFilled = false;
  ibanAutoFilled = false;
  empfaengerAutoFilled = false;
  produktInput.value = "";
  betragInput.value = "";
  notizInput.value = "";
  referenzInput.value = "";
  adresseInput.value = "";
  empfaengerInput.value = "";
  ibanInput.value = "";
  erhaltenInput.value = toISO(new Date());
  kaufdatumInput.value = toISO(new Date());
  garantiedauerInput.value = "2";
  Object.values(DIRECT_DATE_FIELDS).forEach(({ input }) => { input.value = toISO(addDays(new Date(), 14)); });
  fileInput.value = "";
  fileAddPageInput.value = "";
  fileAddPageCameraInput.value = "";
  fileRow.style.display = "none";
  pageThumbs.style.display = "none";
  pageThumbs.innerHTML = "";
  btnAddPage.style.display = "none";
  fileError.style.display = "none";
  ocrStatus.style.display = "none";
  typeOpts.forEach((o) => o.classList.toggle("active", o.dataset.type === currentType));
  // Garantie wird nicht über die normale Kategorie-Auswahl angelegt
  // (seltener gebraucht), sondern nur über das Garantie-Archiv — dort ist
  // der Typ schon feststehend, die Auswahl wird dann ausgeblendet.
  fieldArt.style.display = presetType ? "none" : "block";
  formTitle.textContent = presetType === "garantie" ? "Neue Garantie eintragen" : "Neue Frist eintragen";
  setVisibleFields(currentType);
  updatePreview();
  overlay.style.display = "flex";
  produktInput.focus();
}
function closeModal() { overlay.style.display = "none"; }

function activeDateInput() {
  if (currentType === "retoure") return erhaltenInput;
  if (currentType === "garantie") return kaufdatumInput;
  const conf = DIRECT_DATE_FIELDS[currentType];
  return conf ? conf.input : null;
}

function currentDeadline() {
  if (currentType === "retoure") return computeRetourenDeadline(erhaltenInput.value || toISO(new Date()));
  if (currentType === "garantie") return computeGarantieEnde(kaufdatumInput.value || toISO(new Date()), garantiedauerInput.value || 0);
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
kaufdatumInput.addEventListener("input", () => { dateTouched = true; });
kaufdatumInput.addEventListener("change", updatePreview);
garantiedauerInput.addEventListener("input", updatePreview);
erhaltenInput.addEventListener("change", updatePreview);
Object.values(DIRECT_DATE_FIELDS).forEach(({ input }) => {
  input.addEventListener("input", () => { dateTouched = true; });
  input.addEventListener("change", updatePreview);
});
betragInput.addEventListener("input", () => {
  betragTouched = true;
  betragInput.setCustomValidity("");
  // nur Ziffern, Komma und Punkt zulassen (wie ein Zahlenfeld)
  const cleaned = betragInput.value.replace(/[^\d.,]/g, "");
  if (cleaned !== betragInput.value) betragInput.value = cleaned;
});
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
  pageThumbs.style.display = "none";
  pageThumbs.innerHTML = "";
  btnAddPage.style.display = "none";
  currentBelegPages = [];
  try {
    if (isPdfFile(file)) {
      if (file.size > 2.5 * 1024 * 1024) {
        fileError.textContent = "PDF ist größer als 2,5 MB — es wird nur der Dateiname gespeichert.";
        fileError.style.display = "block";
        currentBelegDraft = { name: file.name, mime: "application/pdf", dataUrl: null };
        showFileRow();
        runOcr(file); // Texterkennung funktioniert unabhängig von der Speicherung
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        let dataUrl = ev.target.result;
        // Ohne MIME-Typ liefert FileReader "data:application/octet-stream" — korrigieren,
        // damit die PDF-Vorschau den Beleg später als PDF öffnet.
        if (typeof dataUrl === "string") dataUrl = dataUrl.replace(/^data:(application\/octet-stream)?;base64,/, "data:application/pdf;base64,");
        currentBelegDraft = { name: file.name, mime: "application/pdf", dataUrl };
        showFileRow();
      };
      reader.onerror = () => {
        fileError.textContent = "Die Datei konnte nicht gelesen werden. Liegt sie nur in der Cloud (z. B. Google Drive), lade sie zuerst auf das Gerät herunter.";
        fileError.style.display = "block";
      };
      reader.readAsDataURL(file);
      runOcr(file);
    } else {
      const dataUrl = await resizeImage(file);
      currentBelegPages = [dataUrl];
      currentBelegDraft = { name: file.name, mime: "image/jpeg", dataUrl, pages: currentBelegPages };
      fileRow.style.display = "none";
      renderPageThumbs();
      btnAddPage.style.display = "flex";
      runOcr(file); // im Hintergrund, blockiert das Formular nicht
    }
  } catch (e) {
    fileError.textContent = "Datei konnte nicht gelesen werden. Unterstützt werden Fotos (JPG, PNG) und PDF.";
    fileError.style.display = "block";
  }
});

// Zwei getrennte Wege für weitere Seiten: Android (ab 14) öffnet bei
// reinen Bild-Feldern die Fotoauswahl OHNE Kamera — deshalb gibt es einen
// eigenen Kamera-Knopf (capture), der direkt die Kamera startet.
$("#btn-add-page-camera").addEventListener("click", () => {
  fileAddPageCameraInput.value = "";
  fileAddPageCameraInput.click();
});
$("#btn-add-page-gallery").addEventListener("click", () => {
  fileAddPageInput.value = "";
  fileAddPageInput.click();
});

const MAX_BELEG_PAGES = 10;

async function handleAddPageInput(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  fileError.style.display = "none";
  if (currentBelegPages.length >= MAX_BELEG_PAGES) {
    fileError.textContent = `Maximal ${MAX_BELEG_PAGES} Seiten pro Beleg.`;
    fileError.style.display = "block";
    return;
  }
  try {
    const dataUrl = await resizeImage(file);
    currentBelegPages.push(dataUrl);
    updateBelegDraftFromPages();
    renderPageThumbs();
    runOcr(file); // füllt nur noch offene Lücken, siehe die *AutoFilled-Sperren in runOcr()
  } catch (e) {
    fileError.textContent = "Seite konnte nicht gelesen werden. Bitte ein Foto (JPG oder PNG) wählen.";
    fileError.style.display = "block";
  }
}
fileAddPageInput.addEventListener("change", () => handleAddPageInput(fileAddPageInput));
fileAddPageCameraInput.addEventListener("change", () => handleAddPageInput(fileAddPageCameraInput));

function updateBelegDraftFromPages() {
  currentBelegDraft = {
    name: currentBelegPages.length > 1 ? `Beleg (${currentBelegPages.length} Seiten)` : (currentBelegDraft && currentBelegDraft.name) || "Beleg",
    mime: "image/jpeg",
    dataUrl: currentBelegPages[0] || null,
    pages: currentBelegPages,
  };
}

function renderPageThumbs() {
  pageThumbs.innerHTML = "";
  if (!currentBelegPages.length) {
    pageThumbs.style.display = "none";
    btnAddPage.style.display = "none";
    return;
  }
  pageThumbs.style.display = "flex";
  btnAddPage.style.display = currentBelegPages.length < MAX_BELEG_PAGES ? "flex" : "none";
  currentBelegPages.forEach((src, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "fw-page-thumb-wrap";
    const img = document.createElement("img");
    img.src = src;
    const num = document.createElement("span");
    num.className = "fw-page-thumb-num";
    num.textContent = String(idx + 1);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "fw-page-thumb-remove";
    removeBtn.setAttribute("aria-label", "Seite entfernen");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      currentBelegPages.splice(idx, 1);
      if (currentBelegPages.length === 0) {
        currentBelegDraft = null;
        fileInput.value = "";
      } else {
        updateBelegDraftFromPages();
      }
      renderPageThumbs();
    });
    wrap.appendChild(img);
    wrap.appendChild(num);
    wrap.appendChild(removeBtn);
    pageThumbs.appendChild(wrap);
  });
}

// Liefert erkannten Text — aus der Textebene eines PDFs (mit OCR-Fallback
// für gescannte PDFs) oder per Bild-OCR für Fotos.
async function getTextFromFile(file) {
  if (isPdfFile(file)) return extractTextFromPdf(file);
  // Eigene, größere und aufbereitete Version nur für die Texterkennung — die
  // gespeicherte Beleg-Vorschau bleibt bei der kleineren Auflösung.
  const ocrCanvas = await prepareImageForOcr(file);
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(ocrCanvas);
  return { text: (data && data.text) || "", lines: linesFromTesseractData(data) };
}

function setOcrStatus(state, text) {
  // state: "loading" | "success" | "neutral"
  ocrStatus.style.display = "flex";
  ocrStatus.className = `fw-ocr-status is-${state}`;
  ocrSpinner.style.display = state === "loading" ? "block" : "none";
  ocrStatusText.textContent = text;
}

async function runOcr(file) {
  // Deutlich sichtbarer Hinweis, solange der Scan läuft — leicht zu
  // übersehen, wenn es nur ein kleiner grauer Text ist.
  setOcrStatus("loading", isPdfFile(file) ? "PDF wird gelesen …" : "Beleg wird gelesen …");
  try {
    const raw = await getTextFromFile(file);
    const text = normalizeOcrText(raw.text);
    const lines = raw.lines;
    const applied = [];

    if (!dateTouched && !dateAutoFilled) {
      const guessedDate = parseDateFromText(text, currentType);
      const input = activeDateInput();
      if (guessedDate && input) {
        input.value = toISO(guessedDate);
        updatePreview();
        dateAutoFilled = true;
        applied.push("Datum");
      }
    }
    if (!betragTouched && !betragAutoFilled) {
      const amount = parseAmountFromText(text);
      if (amount !== null && !isNaN(amount)) {
        betragInput.value = formatBetragInput(amount);
        betragAutoFilled = true;
        applied.push("Betrag");
      }
    }
    // Anbieter/Absender: Punktesystem aus mehreren Hinweisen (Absender-
    // Kennzeichnung, Rücksendezeile, Rechtsform, Briefkopf, Zahlungsempfänger …),
    // siehe detectProvider(). Ist der Anbieter nicht gut gekennzeichnet, wird
    // der Zahlungsempfänger übernommen.
    const providerInfo = detectProvider(text, lines, currentType, loadSender());
    const headerGuess = providerInfo.provider;
    if (!produktTouched && headerGuess) {
      const fresh = !produktAutoFilled && !produktInput.value.trim();
      // Bei weiteren Seiten einen deutlich sichereren Treffer nachträglich übernehmen
      const better = produktAutoFilled && providerInfo.score > produktAutoScore + 1.5 && produktInput.value.trim() !== headerGuess;
      if (fresh || better) {
        produktInput.value = headerGuess;
        saveBtn.disabled = false;
        produktAutoFilled = true;
        produktAutoScore = providerInfo.score;
        applied.push("Anbieter");
      }
    }
    if (!referenzTouched && !referenzAutoFilled && (REFERENZ_LABELS[currentType])) {
      const ref = parseReferenceFromText(text, currentType);
      if (ref) {
        referenzInput.value = ref;
        referenzAutoFilled = true;
        applied.push(currentType === "rechnung" ? "Referenznummer" : currentType === "abo" ? "Kundennummer" : "Aktenzeichen");
      }
    }
    if (currentType === "rechnung") {
      if (!ibanTouched && !ibanAutoFilled) {
        const iban = parseIbanFromText(text);
        if (iban) {
          ibanInput.value = formatIban(iban);
          ibanAutoFilled = true;
          applied.push("IBAN");
        }
      }
      if (!empfaengerTouched && !empfaengerAutoFilled) {
        // Gleiches Verfahren wie beim Anbieter: erst explizites Stichwort
        // ("Zahlungsempfänger", "Kontoinhaber" …), sonst dieselbe
        // Kopfzeilen-Erkennung, sonst als letzte Rückfallebene das bereits
        // erkannte Anbieter-Feld.
        const recipient = providerInfo.recipient || headerGuess || produktInput.value.trim() || null;
        if (recipient) {
          empfaengerInput.value = recipient;
          empfaengerAutoFilled = true;
          applied.push("Zahlungsempfänger");
        }
      }
    }

    if (applied.length) {
      setOcrStatus("success", `Aus dem Beleg erkannt: ${applied.join(", ")} — bitte prüfen.`);
    } else {
      setOcrStatus("neutral", "Auf dieser Seite konnte nichts Eindeutiges (mehr) erkannt werden.");
    }
  } catch (e) {
    console.warn("Texterkennung fehlgeschlagen:", e);
    const msg = String((e && e.message) || e || "");
    if (navigator.onLine === false) {
      setOcrStatus("neutral", "Keine Internetverbindung — die Texterkennung braucht beim ersten Mal Internet. Der Beleg ist trotzdem gespeichert, die Felder kannst du von Hand ausfüllen.");
    } else if (/password/i.test(msg)) {
      setOcrStatus("neutral", "Das PDF ist passwortgeschützt und kann nicht gelesen werden. Der Beleg ist trotzdem gespeichert.");
    } else if (/invalid pdf|corrupt|unexpected/i.test(msg)) {
      setOcrStatus("neutral", "Das PDF konnte nicht gelesen werden (Datei beschädigt oder kein echtes PDF).");
    } else {
      setOcrStatus("neutral", "Automatische Erkennung hat diesmal nicht geklappt — bitte die Felder von Hand ausfüllen.");
    }
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

$("#btn-add").addEventListener("click", () => openModal());
$("#fab-add").addEventListener("click", () => openModal());
$("#btn-cancel").addEventListener("click", closeModal);
overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeModal(); });

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!produktInput.value.trim()) return;
  const betragWert = parseBetragInput(betragInput.value);
  if (Number.isNaN(betragWert)) {
    betragInput.setCustomValidity("Bitte den Betrag als Zahl eingeben, z. B. 49,90");
    betragInput.reportValidity();
    betragInput.focus();
    return;
  }
  const deadline = currentDeadline();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: currentType,
    produkt: produktInput.value.trim(),
    erhalten: currentType === "retoure" ? erhaltenInput.value : null,
    kaufdatum: currentType === "garantie" ? kaufdatumInput.value : null,
    garantieJahre: currentType === "garantie" ? Number(garantiedauerInput.value) || 0 : null,
    deadline,
    betrag: betragWert,
    notiz: notizInput.value.trim(),
    referenz: (REFERENZ_LABELS[currentType]) ? referenzInput.value.trim() : "",
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
// Prüft die echten Datei-Signaturen (Magic Bytes) gängiger Bildformate,
// statt nur dem behaupteten "data:image/..."-Präfix zu vertrauen — eine
// über einen Backup-Import eingeschleuste, falsch benannte Datei fällt
// damit auf. Gibt bei gültigem Bild die (ggf. bereinigte) Data-URL zurück,
// sonst null.
function sanitizeImageDataUrl(value) {
  if (typeof value !== "string") return null;
  const m = value.match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const b64 = m[2].replace(/\s+/g, "");
  if (!b64 || b64.length % 4 !== 0) return null;

  let bin;
  try {
    bin = atob(b64);
  } catch (e) {
    return null;
  }
  if (!bin || bin.length < 4) return null;

  const hasPngSig =
    bin.length >= 8 &&
    bin.charCodeAt(0) === 0x89 && bin.charCodeAt(1) === 0x50 && bin.charCodeAt(2) === 0x4e && bin.charCodeAt(3) === 0x47 &&
    bin.charCodeAt(4) === 0x0d && bin.charCodeAt(5) === 0x0a && bin.charCodeAt(6) === 0x1a && bin.charCodeAt(7) === 0x0a;
  const hasJpegSig = bin.length >= 3 && bin.charCodeAt(0) === 0xff && bin.charCodeAt(1) === 0xd8 && bin.charCodeAt(2) === 0xff;
  const hasGifSig = bin.startsWith("GIF87a") || bin.startsWith("GIF89a");
  const hasWebpSig = bin.length >= 12 && bin.startsWith("RIFF") && bin.slice(8, 12) === "WEBP";

  if (mime === "png" && !hasPngSig) return null;
  if ((mime === "jpg" || mime === "jpeg") && !hasJpegSig) return null;
  if (mime === "gif" && !hasGifSig) return null;
  if (mime === "webp" && !hasWebpSig) return null;

  return `data:image/${mime};base64,${b64}`;
}

function openViewer(beleg) {
  currentBeleg = beleg;
  viewerBox.innerHTML = "";
  // Sicherheit: nicht dem behaupteten Data-URL-Präfix allein vertrauen —
  // die echten Datei-Signaturen (Magic Bytes) der gängigen Bildformate
  // prüfen. Der PDF-Viewer läuft zusätzlich in einem "sandbox"-iframe
  // ohne Skriptrechte.
  const isRealPdf = typeof beleg.dataUrl === "string" && beleg.dataUrl.startsWith("data:application/pdf");
  // Mehrseitige Fotobelege: jede Seite einzeln validieren, ungültige
  // Seiten werden übersprungen statt die ganze Ansicht zu blockieren.
  const pageList = Array.isArray(beleg.pages) && beleg.pages.length ? beleg.pages : [beleg.dataUrl];
  const safeImagePages = pageList.map((p) => sanitizeImageDataUrl(p)).filter((p) => p !== null);
  const isRealImage = safeImagePages.length > 0;

  if (isRealPdf) {
    const iframe = document.createElement("iframe");
    iframe.src = beleg.dataUrl;
    iframe.style.width = "80vw";
    iframe.style.height = "78vh";
    iframe.style.border = "none";
    iframe.setAttribute("sandbox", ""); // keine Skriptausführung, keine Formulare, keine Navigation
    viewerBox.appendChild(iframe);
  } else if (isRealImage) {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "10px";
    wrap.style.maxHeight = "78vh";
    wrap.style.overflowY = "auto";
    safeImagePages.forEach((src) => {
      const img = document.createElement("img");
      img.src = src;
      img.className = "fw-viewer-img";
      wrap.appendChild(img);
    });
    viewerBox.appendChild(wrap);
  } else {
    const p = document.createElement("p");
    p.style.padding = "20px";
    p.textContent = beleg.dataUrl
      ? "Diese Datei kann aus Sicherheitsgründen nicht angezeigt werden."
      : `Datei zu groß für die lokale Vorschau: ${beleg.name}`;
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
const PBKDF2_ITERATIONS = 600000; // OWASP-Empfehlung (Stand 2026) für PBKDF2-HMAC-SHA256

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
    // Sicherheit: jeden Eintrag auf eine bekannte, feste Form zurechtstutzen,
    // statt beliebige Felder/Werte aus der Datei ungeprüft zu übernehmen.
    const before = importedEntries.length;
    importedEntries = importedEntries.filter((e) => e && typeof e === "object" && typeof e.id === "string").map(sanitizeImportedEntry);
    if (importedEntries.length < before) {
      importInfo.style.display = "block";
      importInfo.textContent = `${before - importedEntries.length} Eintrag/Einträge übersprungen (ungültiges Format).`;
    }
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

/* ---- Garantie-Archiv ---- */
function renderGarantieArchiv() {
  const garantieEntries = sortEntries(entries.filter((e) => e.type === "garantie"), sortMode);
  garantieList.innerHTML = "";
  if (garantieEntries.length === 0) {
    garantieList.innerHTML = `<div class="fw-empty">
      <div class="fw-empty-title">Noch keine Garantie eingetragen</div>
      <p>Kaufbeleg fotografieren — Kaufdatum, Händler und Betrag werden automatisch erkannt.</p>
    </div>`;
    return;
  }
  garantieEntries.forEach((entry) => garantieList.appendChild(renderCard(entry)));
}
function openGarantieArchiv() {
  menuDropdown.style.display = "none";
  renderGarantieArchiv();
  garantieOverlay.style.display = "flex";
}
$("#menu-garantie").addEventListener("click", openGarantieArchiv);
statGarantieBtn.addEventListener("click", openGarantieArchiv);
$("#garantie-close").addEventListener("click", () => { garantieOverlay.style.display = "none"; });
garantieOverlay.addEventListener("mousedown", (e) => { if (e.target === garantieOverlay) garantieOverlay.style.display = "none"; });
$("#btn-add-garantie").addEventListener("click", () => openModal("garantie"));

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
  { match: ["netflix"], name: "Netflix", url: "https://www.netflix.com/de/", category: "streaming" },
  { match: ["disney"], name: "Disney+", url: "https://www.disneyplus.com/de-de", category: "streaming" },
  { match: ["amazon prime", "prime video"], name: "Amazon Prime Video", url: "https://www.primevideo.com/", category: "streaming" },
  { match: ["spotify"], name: "Spotify", url: "https://www.spotify.com/de/premium/", category: "streaming" },
  { match: ["dazn"], name: "DAZN", url: "https://www.dazn.com/de-DE/welcome", category: "streaming" },
  { match: ["sky", "wow"], name: "WOW (ehem. Sky Ticket)", url: "https://www.wow.de/", category: "streaming" },
  { match: ["apple tv"], name: "Apple TV+", url: "https://www.apple.com/de/apple-tv-plus/", category: "streaming" },
  { match: ["youtube premium", "youtube music"], name: "YouTube Premium", url: "https://www.youtube.com/premium", category: "streaming" },
  { match: ["audible"], name: "Audible", url: "https://www.audible.de/", category: "streaming" },
  { match: ["paramount"], name: "Paramount+", url: "https://www.paramountplus.com/de/", category: "streaming" },
  { match: ["magenta"], name: "MagentaTV", url: "https://www.telekom.de/magenta-tv", category: "streaming" },
  { match: ["joyn"], name: "Joyn", url: "https://www.joyn.de/", category: "streaming" },
  { match: ["vodafone"], name: "Vodafone", url: "https://www.vodafone.de/", category: "mobilfunk" },
  { match: ["telekom", "t-mobile"], name: "Telekom", url: "https://www.telekom.de/mobilfunk", category: "mobilfunk" },
  { match: ["o2", "telefónica", "telefonica"], name: "o2", url: "https://www.o2online.de/", category: "mobilfunk" },
  { match: ["1&1", "1&amp;1"], name: "1&1", url: "https://www.1und1.de/", category: "mobilfunk" },
  { match: ["congstar"], name: "congstar", url: "https://www.congstar.de/", category: "mobilfunk" },
];
function matchKnownProvider(produktName) {
  const lower = produktName.toLowerCase();
  return KNOWN_PROVIDERS.find((p) => p.match.some((m) => lower.includes(m))) || null;
}

// Verivox/Check24 sind riesige Portale mit vielen Sparten (Strom, DSL,
// Mobilfunk, Streaming, Versicherung …) — ein einzelner fest verdrahteter
// Link passt fast nie zum tatsächlichen Abo. Deshalb wird hier erst die
// Kategorie des Eintrags bestimmt (über den erkannten Anbieter oder über
// Schlüsselwörter im Titel) und nur bei einer Kategorie mit verifizierter
// Vergleichsseite werden Verivox/Check24 überhaupt angezeigt. Ohne
// eindeutige Kategorie bleibt nur die Google-Suche übrig, statt einen
// falschen Vergleichslink zu zeigen.
const CATEGORY_KEYWORDS = {
  mobilfunk: ["mobilfunk", "handyvertrag", "handytarif", "sim-only", "sim only", "prepaid"],
};
const CATEGORY_PORTALS = {
  streaming: {
    subLabel: "Streaming-Vergleich",
    verivoxUrl: "https://www.verivox.de/streaming/angebote/",
    check24Url: "https://www.check24.de/internet/streaming/",
  },
  mobilfunk: {
    subLabel: "Mobilfunk-Vergleich",
    verivoxUrl: "https://www.verivox.de/handy/mobilfunk/",
    check24Url: "https://handytarife.check24.de/",
  },
};
function detectCategory(produktName, provider) {
  if (provider) return provider.category;
  const lower = produktName.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return cat;
  }
  return null;
}

const compareOverlay = $("#compare-overlay");
const compareSubtitle = $("#compare-subtitle");
const compareButtonsWrap = $("#compare-buttons");

function makeCompareButton({ label, sub, url }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fw-compare-btn";

  const left = document.createElement("span");
  const labelEl = document.createElement("span");
  labelEl.className = "fw-compare-label";
  labelEl.textContent = label;
  const subEl = document.createElement("span");
  subEl.className = "fw-compare-sub";
  subEl.textContent = sub;
  left.appendChild(labelEl);
  left.appendChild(subEl);

  const arrow = document.createElement("span");
  arrow.className = "fw-compare-arrow";
  arrow.textContent = "↗";

  btn.appendChild(left);
  btn.appendChild(arrow);
  btn.addEventListener("click", () => {
    window.open(url, "_blank", "noopener,noreferrer");
  });
  return btn;
}

// Zeigt ein Popup mit Buttons statt einer PDF — Klick auf eine Option
// leitet direkt (neuer Tab) zur Zielseite weiter. Bewusst keine
// Preisangaben, da sich Abo-Preise laufend ändern; die Links bleiben
// dadurch immer aktuell.
function openComparePopup(entry) {
  const provider = matchKnownProvider(entry.produkt);
  const category = detectCategory(entry.produkt, provider);
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent("günstigere Alternative zu " + entry.produkt)}`;

  compareSubtitle.textContent = `Für: ${entry.produkt}`;
  compareButtonsWrap.innerHTML = "";

  if (provider) {
    compareButtonsWrap.appendChild(
      makeCompareButton({ label: provider.name, sub: "Offizielle Seite – aktuelle Tarife/Pakete", url: provider.url })
    );
  }
  const portals = category ? CATEGORY_PORTALS[category] : null;
  if (portals) {
    compareButtonsWrap.appendChild(
      makeCompareButton({ label: "Verivox", sub: `Unabhängiger ${portals.subLabel}`, url: portals.verivoxUrl })
    );
    compareButtonsWrap.appendChild(
      makeCompareButton({ label: "Check24", sub: `Unabhängiger ${portals.subLabel}`, url: portals.check24Url })
    );
  }
  compareButtonsWrap.appendChild(
    makeCompareButton({ label: "Google-Suche", sub: `"Günstigere Alternative zu ${entry.produkt}"`, url: searchUrl })
  );

  compareOverlay.style.display = "flex";
}
$("#compare-close").addEventListener("click", () => { compareOverlay.style.display = "none"; });
compareOverlay.addEventListener("mousedown", (e) => { if (e.target === compareOverlay) compareOverlay.style.display = "none"; });

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
