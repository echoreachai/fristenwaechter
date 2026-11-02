# Fristen-Wächter (PWA)

Eine installierbare Web-App zum Verfolgen von Widerrufs- und Kündigungsfristen.
Alle Daten (inkl. Fotos/PDFs) bleiben **nur auf deinem Gerät** (localStorage) —
es gibt keinen Server, der Daten sammelt.

## Kurzbeschreibung 
Retouren, Abos, Strafzettel & Rechnungen – nie wieder eine Frist verpassen.

## Vollständige Beschreibung 

Fristen-Wächter behält für dich im Blick, was sonst im E-Mail-Postfach oder
im Papierstapel untergeht: Widerrufsfristen bei Online-Bestellungen,
Kündigungsfristen bei Abos, Einspruchsfristen bei Strafzetteln und
Fälligkeitstermine bei offenen Rechnungen.

WAS DIE APP KANN

• Automatische Fristberechnung: Bei Retouren berechnet die App die
14-tägige Widerrufsfrist automatisch – inklusive gesetzlicher Feiertage.

• Vier Kategorien: Widerruf/Retoure, Abo-Kündigung, Strafzettel, Offene
Rechnung – jede mit den passenden Feldern.

• Beleg-Scan mit Texterkennung: Foto oder PDF hochladen, die App liest
Datum, Betrag, Anbieter, Referenznummer, IBAN und Zahlungsempfänger
automatisch aus und trägt sie ins Formular ein.

• Fertige Schreiben als PDF: Für Abo-Kündigungen und Einsprüche gegen
Strafzettel erstellt die App auf Knopfdruck eine formatierte,
versandfertige Brief-Vorlage zum Download.

• Backup & Wiederherstellung: Alle Einträge inklusive Fotos lassen sich
als Datei exportieren – optional passwortverschlüsselt – und auf einem
anderen Gerät wiederherstellen.

• Übersichtliches Dashboard: Auf einen Blick siehst du, welche Fristen
dringend sind, welche bald anstehen und welche du bereits erledigt hast.

DEINE DATEN BLEIBEN AUF DEINEM GERÄT

Fristen-Wächter speichert alles ausschließlich lokal auf deinem Handy.
Es gibt keinen Server, keine Cloud, kein Nutzerkonto und keine Werbung.
Auch die Texterkennung läuft komplett auf deinem Gerät – deine Fotos und
Dokumente verlassen dein Handy nicht.

FÜR WEN

Für alle, die online bestellen, Abos abgeschlossen haben oder einfach den
Überblick über Fristen und offene Zahlungen behalten wollen, ohne dafür
das E-Mail-Postfach zu durchsuchen.

Feedback und Ideen? Direkt in der App über das Menü → "Feedback senden".

"Es werden keine Nutzerdaten erhoben oder weitergegeben" (No data
collected / No data shared) – da alle Daten ausschließlich lokal auf dem
Gerät gespeichert werden. Ausnahme ggf. korrekt angeben: Der Browser lädt
beim Start technische JS-Bibliotheken von CDN-Anbietern (jsDelivr,
cdnjs, Google Fonts) nach – dabei werden keine App- oder Nutzerdaten
übertragen, nur die IP-Adresse ist technisch bedingt sichtbar (wie bei
jedem Laden einer Web-Ressource).
## Dateien

- `index.html` — App-Grundgerüst
- `styles.css` — Design (Postbuch-/Stempel-Optik)
- `app.js` — komplette App-Logik (Fristenberechnung, Speicherung, UI)
- `manifest.json` — macht die Seite installierbar
- `sw.js` — Service Worker (Offline-Cache + Best-Effort-Hintergrundprüfung)
- `icons/` — App-Icons (192px, 512px, maskable)
