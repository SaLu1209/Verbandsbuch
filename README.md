# Digitales Verbandsbuch

Web-Anwendung zur Dokumentation von Erste-Hilfe-Leistungen nach § 24 Abs. 6 DGUV Vorschrift 1.

**So funktioniert's:** Jeder Verbandkasten bzw. Standort bekommt einen eigenen **Zugangscode mit QR-Code**.
Der ausgedruckte Aushang hängt am Verbandkasten. Wer Erste Hilfe geleistet hat, scannt den QR-Code mit dem
Smartphone (oder gibt den Code auf der Startseite ein) und füllt das Formular aus. Ohne gültigen Code ist das
Formular nicht erreichbar. Die Einträge sehen nur angemeldete Verwalter (z. B. Fachkraft für Arbeitssicherheit).

## Funktionen

- Formular mit allen Pflichtangaben: verletzte Person, Zeit/Ort, Hergang, Art und Umfang der Verletzung,
  Zeugen, Zeit und Art der Erste-Hilfe-Maßnahmen, Name des Erste-Hilfe-Leistenden
- Zugang per QR-Code oder 8-stelligem Code, je Standort; Codes können neu erzeugt oder gesperrt werden
- Druckfertiger Aushang (A4) mit QR-Code pro Standort
- Verwaltung: Liste mit Suche und Filtern, Detailansicht, Druck/PDF, CSV-Export (Excel-kompatibel)
- Aufbewahrung: Hinweis auf die 5-Jahres-Frist und Löschen älterer Einträge
- Schutz: passwortgeschützte Verwaltung, Begrenzung von Fehlversuchen, Sicherheits-Header

## Starten

Voraussetzung: Node.js ≥ 22.5 (nutzt das eingebaute SQLite).

```bash
npm install
ADMIN_PASSWORD='ein-sicheres-passwort' ORG_NAME='Musterfirma GmbH' npm start
```

Dann `http://localhost:3000/admin` öffnen, anmelden, unter **Standorte & QR-Codes** einen Standort anlegen und
den Aushang drucken.

| Variable          | Bedeutung                                                                 |
|-------------------|---------------------------------------------------------------------------|
| `ADMIN_PASSWORD`  | Passwort der Verwaltung. Fehlt es, wird eines erzeugt und in `data/admin-passwort.txt` gespeichert. |
| `BASE_URL`        | Öffentliche Adresse, die in die QR-Codes geschrieben wird, z. B. `https://verbandsbuch.firma.de`. Ohne Angabe wird die aufgerufene Adresse verwendet. |
| `ORG_NAME`        | Firmenname für Kopfzeile und Aushang (optional)                           |
| `PORT`            | Port (Standard 3000)                                                      |
| `DATA_DIR`        | Ablage der Datenbank (Standard `./data`)                                  |
| `SECURE_COOKIES`  | `1` setzen, wenn die Anwendung per HTTPS läuft                            |
| `TZ`              | Zeitzone, z. B. `Europe/Berlin`                                           |

## Betrieb

- Damit Mitarbeitende mit ihrem Smartphone zugreifen können, muss der Server im Firmen-WLAN bzw. Internet
  erreichbar sein – idealerweise hinter einem Reverse-Proxy mit HTTPS (z. B. Caddy oder nginx).
- Die Daten liegen in `data/verbandsbuch.sqlite`. Dieses Verzeichnis regelmäßig sichern.
- Es handelt sich um Gesundheitsdaten (Art. 9 DSGVO): Zugriff auf die Verwaltung nur für berechtigte Personen,
  Datenschutzbeauftragte/n einbinden.

## Offline-Version (eine einzige Datei, ohne Server)

`offline/verbandsbuch.html` ist eine eigenständige Version, die komplett im Browser läuft – ohne Server,
ohne Installation und ohne Internet. Datei herunterladen und per Doppelklick öffnen (Chrome, Edge, Firefox, Safari).

- Gleiches Formular, Zugangscodes je Standort, Verwaltung mit PIN, Suche, Druck, CSV-Export, Aushang
- **Daten liegen nur im Browser des jeweiligen Geräts.** Geeignet z. B. für ein festes Tablet/einen PC an der
  Erste-Hilfe-Station. Unter *Einstellungen & Sicherung* regelmäßig eine Sicherung (JSON) herunterladen;
  sie lässt sich auf demselben oder einem anderen Gerät wiederherstellen.
- Wird die Datei direkt von der Festplatte geöffnet, zeigt der Aushang nur den Zugangscode. Liegt sie auf einem
  Webserver, enthält der Aushang zusätzlich einen QR-Code – dann speichert aber jedes Handy seine Einträge
  für sich. Für zentrale Einträge von mehreren Geräten die Server-Version oben verwenden.
- Die PIN schützt vor neugierigen Blicken, ist aber kein Schutz gegen technisch versierte Personen mit Zugriff auf das Gerät.

Nach Änderungen an `offline/app.src.html` neu bauen: `npm run build:offline`.

## Tests

```bash
npm test
```
