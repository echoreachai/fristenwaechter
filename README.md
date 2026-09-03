# Fristen-Wächter (PWA)

Eine installierbare Web-App zum Verfolgen von Widerrufs- und Kündigungsfristen.
Alle Daten (inkl. Fotos/PDFs) bleiben **nur auf deinem Gerät** (localStorage) —
es gibt keinen Server, der Daten sammelt.

## Änderungen werden nicht sichtbar? (Service-Worker-Cache)

Die App merkt sich Dateien für die Offline-Nutzung. Ab dieser Version lädt
sie ihre eigenen Dateien **netzwerk-zuerst** nach, das heißt: Sobald du
eine neue Version ins Repo hochlädst und dein Handy online ist, sollte die
App beim nächsten Öffnen automatisch aktuell sein.

Falls trotzdem noch der alte Stand angezeigt wird (z. B. weil eine ältere
Version der App bei dir installiert war, die noch die alte Cache-first-
Strategie genutzt hat), einmalig:

1. App schließen (aus den zuletzt geöffneten Apps entfernen, nicht nur
   minimieren).
2. In Chrome: **Drei-Punkte-Menü → Einstellungen → Datenschutz und
   Sicherheit → Browserdaten löschen** → nur "Bilder und Dateien im Cache"
   für den Zeitraum "Letzte Stunde" (oder gezielt die Website-Daten für
   deine GitHub-Pages-Domain löschen, falls Chrome das anbietet).
3. App erneut öffnen (ggf. neu installieren).

Danach greift wieder die neue, netzwerk-zuerst-Strategie und Updates
kommen zuverlässig an.

## Warum hosten?

Damit Android Chrome die App als "echte" App anbietet (Icon auf dem
Homescreen, Vollbild, Offline-Nutzung), muss sie über **HTTPS** ausgeliefert
werden. Einfaches Doppelklicken der `index.html` reicht dafür nicht aus.
Der schnellste kostenlose Weg ist GitHub Pages.

## In 5 Minuten live schalten (GitHub Pages)

1. Erstelle ein neues, öffentliches GitHub-Repository (z. B. `fristen-waechter`).
2. Lade alle Dateien aus diesem Ordner in das Repository hoch (per Web-Oberfläche
   "Add file → Upload files", oder per Git).
3. Gehe zu **Settings → Pages**.
4. Bei "Source" wähle den `main`-Branch und den Ordner `/ (root)`. Speichern.
5. Nach ca. 1 Minute ist die App unter `https://DEIN-NUTZERNAME.github.io/fristen-waechter/` erreichbar.

Alternativen mit demselben Ergebnis: Netlify oder Vercel (Ordner per Drag &
Drop hochladen, fertig).

## Auf dem Android-Handy installieren

1. Öffne den Link (siehe oben) in **Chrome** auf deinem Handy.
2. Tippe oben rechts auf das Drei-Punkte-Menü.
3. Wähle **"App installieren"** bzw. **"Zum Startbildschirm hinzufügen"**.
4. Die App erscheint danach wie jede andere App auf deinem Homescreen —
   mit eigenem Icon, ohne Browser-Leiste.

## Erinnerungen / Benachrichtigungen

Beim ersten Öffnen fragt die App nach der Berechtigung für Benachrichtigungen.
Sobald aktiviert, bekommst du eine Benachrichtigung, wenn eine Frist in ≤ 3
Tagen abläuft oder bereits überfällig ist — jedes Mal, wenn du die App öffnest
oder sie im Hintergrund-Tab aktiv ist.

**Wichtige Einschränkung:** Echte Push-Benachrichtigungen bei einer
komplett geschlossenen App erfordern einen Server (Web Push API) — das ist
hier bewusst nicht eingebaut, damit keine Daten irgendwo hochgeladen werden.
Auf manchen Android-Chrome-Versionen versucht die App zusätzlich, eine
"Periodic Background Sync" zu registrieren (prüft still im Hintergrund,
ca. alle 12 Stunden) — das ist aber herstellerabhängig und nicht garantiert.
Am zuverlässigsten: Öffne die App kurz, wenn du an dringende Fristen erinnert
werden willst.

## Zahlungsdaten bei "Offene Rechnung" (IBAN, Zahlungsempfänger, Referenz)

Bei Einträgen vom Typ **Offene Rechnung** gibt es zusätzliche Felder für
Zahlungsempfänger, IBAN und eine Rechnungs-/Verwendungszweck-Nummer — alle
werden beim Foto-/PDF-Scan automatisch mit ausgefüllt, wenn im Beleg
erkennbar:

- **IBAN**: wird per Prüfsummen-Berechnung (ISO-7064-Verfahren) erkannt und
  validiert, damit nicht irgendeine Zahlenfolge im Text fälschlich als IBAN
  übernommen wird. Auf der Karte gibt es einen "IBAN kopieren"-Button für
  die Überweisung.
- **Zahlungsempfänger**: wird anhand von Begriffen wie "Zahlungsempfänger",
  "Kontoinhaber" oder "Begünstigter" gesucht; ohne expliziten Treffer wird
  ersatzweise der erkannte Anbieter-Name übernommen (in den meisten Fällen
  ist der Rechnungssteller auch der Kontoinhaber).
- **Referenznummer**: je nach Kategorie wird nach Rechnungsnummer,
  Kundennummer, Aktenzeichen o. ä. gesucht — die Schlüsselwörter
  unterscheiden sich zwischen Rechnung, Abo und Strafzettel.

Auch die **Betrags-Erkennung** wurde verbessert: Sie bevorzugt jetzt
eindeutig die Gesamtsumme ("Gesamtbetrag", "Endbetrag") und überspringt
bewusst Zwischensummen wie "Nettobetrag", damit nicht versehentlich der
Betrag vor Mehrwertsteuer übernommen wird.

## Texterkennung (OCR) beim Foto-Upload

Beim Hochladen eines Fotos (Lieferschein, Bescheid, Rechnung) liest die App
automatisch Datum, Betrag und einen Anbieter-Vorschlag aus dem Bild und
trägt sie ins Formular ein. Das läuft komplett im Browser (Tesseract.js),
es wird kein Foto irgendwohin hochgeladen.

Bei **PDF-Belegen** wird zuerst versucht, die eingebettete Textebene direkt
auszulesen (schnell, exakt, funktioniert bei den meisten digital erzeugten
Rechnungen/Bescheiden). Enthält das PDF keine Textebene — etwa weil es ein
eingescanntes Dokument ist — rendert die App automatisch die erste Seite
als Bild und liest sie stattdessen per OCR, genau wie bei einem Foto.

Die Datumserkennung ist dabei **kategorie-abhängig**: Bei einer Retoure wird
das Erhalten-/Lieferdatum gesucht, bei Abo/Strafzettel/Rechnung dagegen
gezielt nach Frist- bzw. Fälligkeitsangaben ("Zahlbar bis", "Zahlungsziel",
"Kündigungsfrist" usw.) — nicht das allgemeine Briefkopf-Datum, das bei
Rechnungen meist weiter oben steht als die eigentliche Zahlungsfrist.

Einschränkungen im Standard-Umfang:

- Die Erkennung ist ein **Vorschlag**, keine Garantie — bitte vor dem
  Speichern kurz prüfen, besonders bei unscharfen Fotos oder ungewöhnlichen
  Belegformaten.
- Beim **ersten** Einsatz auf einem Gerät lädt der Browser einmalig die
  benötigten Bibliotheken/Sprachdaten (paar MB) von einem CDN nach — dafür
  ist kurz Internet nötig. Danach funktioniert die Erkennung auch offline.
- Bereits von Hand ausgefüllte Felder werden nicht überschrieben.

## Pro-Features (Vorbereitung)

Es gibt aktuell keine bezahlten Funktionen — die App ist komplett frei
nutzbar. Für den späteren Ausbau existiert bereits eine zentrale Stelle
im Code: `isPro()` ganz oben in `app.js`, die derzeit immer `false`
zurückgibt. Beim Einbau von Google Play Billing (Digital Goods API) wird
nur diese eine Funktion ausgetauscht — Feature-Gating an beliebiger
Stelle dann einfach über `if (!isPro()) { ... }`.

## Alternativen vergleichen (bei Abo-Kündigungen)

Bei Abo-Einträgen gibt es einen Button **"Alternativen vergleichen"**, der
nur bei Klick aktiv wird (keine automatische Hintergrund-Abfrage). Er
erzeugt eine PDF mit:

- der **offiziellen Anbieter-Seite**, falls die App den Dienst erkennt
  (u. a. Netflix, Disney+, Amazon Prime Video, Spotify, DAZN, WOW, Apple
  TV+, YouTube Premium, Audible, Paramount+, MagentaTV, Joyn),
- den unabhängigen Vergleichsportalen **Verivox** und **Check24**,
- einer direkten Google-Suche nach günstigeren Alternativen.

Bei **unbekannten Anbietern** (kein Treffer in der Liste oben) öffnet sich
zusätzlich sofort eine Google-Suche mit dem Eintragstitel als Suchbegriff
in einem neuen Tab — ohne erst die PDF öffnen und den Link anklicken zu
müssen. Die PDF wird trotzdem erzeugt, als Referenz zum Später-Nachschauen.

Bewusst **keine festen Preisangaben**: Da die App keinen Server und keine
Live-Recherche zur Laufzeit hat, würden eingebaute Preise mit der Zeit
veraltet und potenziell falsch sein. Links dagegen bleiben aktuell, weil
sie direkt auf die Quelle verweisen. Es handelt sich um reine Verlinkung,
keine Affiliate-/Provisions-Links.

## Kündigungs- und Einspruchsschreiben (PDF)

Bei Einträgen vom Typ **Abo-Kündigung** und **Strafzettel** gibt es auf der
Karte einen zusätzlichen Button ("Kündigung erstellen" bzw. "Einspruch
erstellen"), der eine fertig formatierte Brief-Vorlage als PDF erzeugt und
zum Download anbietet. Läuft komplett im Browser (jsPDF), es wird nichts
hochgeladen.

Damit das funktioniert:

- **Absenderdaten** einmalig hinterlegen: Menü (⋮) → "Absenderdaten" → Name,
  Straße, PLZ/Ort. Werden nur lokal gespeichert und für jeden Brief
  wiederverwendet.
- Beim Anlegen eines Abo- oder Strafzettel-Eintrags können optional
  **Kundennummer/Aktenzeichen** und die **Anbieter-/Behördenadresse**
  angegeben werden — beides landet dann automatisch im Schreiben. Ohne
  Adresse bleibt im PDF ein Platzhalter zum manuellen Ergänzen stehen.

Wichtig: Das erzeugte PDF ist eine **Vorlage**, kein geprüftes
Rechtsdokument — bitte vor dem Versand durchlesen, und bei einem
Einspruch ggf. noch eine eigene Begründung ergänzen (die App kennt die
Details deines Falls nicht und ist keine Rechtsberatung).

## Feedback senden

Über das Menü (⋮) → "Feedback senden" öffnet sich ein Textfeld. Beim
Klick auf "In Mail-App öffnen" wird die Standard-Mail-App des Handys mit
einer vorausgefüllten Nachricht an `echoreachai@gmail.com` geöffnet — dort
noch einmal auf Senden tippen, dann ist es raus.

Technischer Hinweis: Eine Web-App ohne eigenen Server kann E-Mails nicht
selbst und lautlos verschicken (dafür bräuchte es SMTP-Zugriff, den Browser
nicht haben). Der `mailto:`-Link ist der Standardweg dafür — er erfordert
einen zusätzlichen Tap in der Mail-App, dafür aber kein extra Konto und
keinen zusätzlichen Server.

## Backup & Wiederherstellung

Über das Menü (⋮ oben rechts im Header) lässt sich jederzeit ein
vollständiges Backup aller Einträge (inkl. hinterlegter Fotos/PDFs) als
Datei exportieren und auf einem anderen Gerät wieder importieren.

- **Exportieren**: erzeugt eine `.json`-Datei zum Herunterladen. Optional
  lässt sie sich mit einem selbst gewählten Passwort verschlüsseln
  (AES-256-GCM, Schlüssel wird lokal per PBKDF2 aus dem Passwort abgeleitet
  — das Passwort verlässt nie das Gerät und wird nirgends gespeichert).
  **Wichtig:** Das Passwort gibt es nur einmal — ohne Passwort lässt sich
  ein verschlüsseltes Backup nicht wiederherstellen.
- **Importieren**: Backup-Datei auswählen, bei verschlüsselten Backups das
  Passwort eingeben, dann entweder zu den vorhandenen lokalen Einträgen
  **hinzufügen** (Duplikate anhand der internen ID werden übersprungen)
  oder alle lokalen Einträge damit **ersetzen**.
- Die Verschlüsselung nutzt die Web-Crypto-API des Browsers und benötigt
  daher eine sichere Verbindung — funktioniert automatisch, sobald die App
  über HTTPS läuft (z. B. via GitHub Pages).

## Kategorien

- **Widerruf / Retoure** — Erhalten-Datum eintragen, 14-Tage-Frist wird automatisch berechnet.
- **Abo-Kündigung** — Kündigungsstichtag direkt eintragen.
- **Strafzettel** — Zahlungs-/Einspruchsfrist vom Bescheid eintragen.
- **Offene Rechnung** — Fälligkeitsdatum eintragen.

Bei allen vier Kategorien kann optional ein Betrag in € hinterlegt werden
(z. B. Rückerstattung, Bußgeld oder Rechnungssumme) — er erscheint dann
zusätzlich in der Übersicht.

## Rechtlicher Hinweis zur Fristberechnung

Die 14-Tage-Widerrufsfrist wird ab dem eingetragenen Erhalt-Datum berechnet
und nach § 193 BGB auf den nächsten Werktag verschoben, falls das
rechnerische Ende auf ein Wochenende oder einen bundesweiten bzw.
NRW-Feiertag fällt. Das ist eine Orientierungshilfe für den Alltag,
keine Rechtsberatung — bei wichtigen/hochpreisigen Retouren im Zweifel
die Frist selbst gegenprüfen (z. B. bei abweichenden Vertragsklauseln
oder Sonderfällen wie digitalen Inhalten).

## Dateien

- `index.html` — App-Grundgerüst
- `styles.css` — Design (Postbuch-/Stempel-Optik)
- `app.js` — komplette App-Logik (Fristenberechnung, Speicherung, UI)
- `manifest.json` — macht die Seite installierbar
- `sw.js` — Service Worker (Offline-Cache + Best-Effort-Hintergrundprüfung)
- `icons/` — App-Icons (192px, 512px, maskable)
