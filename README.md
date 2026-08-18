# Fotodokumentation – Bildauswahl

Kleine Web-App zum Sortieren, Beschriften und Kapiteln-Zuordnen von Fotos für
eine Fotodokumentation. Der Bearbeitungsstand wird **automatisch serverseitig
gespeichert** und ist von jedem Gerät über die Deploy-URL erreichbar.

## Funktionen

- **Mehrere Projekte** nebeneinander verwalten (anlegen, umschalten, umbenennen,
  löschen). Jedes Projekt hat eigene Fotos, eigenen Dokumentkopf und eigenes PDF.
  Serverseitig liegt jedes Projekt als eigene JSON-Datei, `index.json` hält die
  Liste und das zuletzt aktive Projekt.
- Fotos per Drag & Drop sortieren und zwischen Kapiteln verschieben
- Beschriftungen und Kapiteltitel bearbeiten
- Kapitel hinzufügen/entfernen, Bilder entfernen/wiederherstellen
- Kapitelbeschreibung je Kapitel (optional, erscheint im PDF)
- **Dokumentkopf** bearbeiten (Titel, Firma, Projekt, Thema, Datum, Aufgenommen durch)
- **PDF-Export** im Schärli-Stil: Kopfzeile, Metablock, Kapitel mit 2-spaltigem
  Bildraster, durchlaufende Bildnummerierung und **automatische Seitenzahlen** in
  der Fusszeile. Erzeugt vollständig im Browser (jsPDF, keine externen Dienste).
- Neue Fotos hochladen (werden automatisch verkleinert, damit der Stand klein bleibt)
- **Auto-Speichern**: Jede Änderung wird nach kurzer Zeit automatisch gespeichert
  (Status oben rechts: „Speichern…“ / „✓ Gespeichert“)
- JSON-Export als Backup
- Optionaler Passwortschutz

## Wie der Stand gespeichert wird

Zwei Speicher-Backends (automatisch gewählt, siehe `storage.js`):

- **Cloud-Datenbank (empfohlen):** Ist `DATABASE_URL` gesetzt (z. B. durch die
  Railway-Postgres-Datenbank), werden alle Projekte in Postgres gespeichert.
  Kein Volume nötig, übersteht Neustarts und Deployments.
- **Dateien/Volume:** Ohne `DATABASE_URL` legt der Server jedes Projekt als
  Datei (`proj_<id>.json`) im Datenverzeichnis ab (`index.json` = Projektliste).
  Auf Railway sollte das Verzeichnis auf einem Volume liegen.

Beim allerersten Start wird ein erstes Projekt aus `data/seed.json` aufgebaut.

## Bildqualität

Die 43 mitgelieferten Fotos sind nur kleine Vorschaubilder (~260 px) aus der
ursprünglichen Datei – im PDF entsprechend pixelig. Für scharfe PDFs die
**Originalfotos** hochladen: Uploads werden auf max. 2200 px bei hoher Qualität
gespeichert, was für den PDF-Druck ausreichend scharf ist.

## Lokal starten

```bash
npm install
npm start
# http://localhost:3000
```

Optional mit Passwort:

```bash
APP_PASSWORD=meinpasswort npm start
```

## Deployment auf Railway (mit Cloud-Datenbank)

1. Auf [railway.app](https://railway.app) einloggen → **New Project** →
   **Deploy from GitHub repo** → dieses Repository und den Branch auswählen.
   Railway erkennt Node.js automatisch und startet mit `npm start`.
2. Im selben Projekt: **＋ New** → **Database** → **Add PostgreSQL**.
   Railway stellt der App automatisch die Variable `DATABASE_URL` bereit – der
   Server nutzt dann die Cloud-Datenbank (kein Volume nötig).
3. Optional: beim App-Service unter **Variables** `APP_PASSWORD = deinPasswort`
   setzen, um die App zu schützen.
4. Beim App-Service unter **Settings → Networking → Generate Domain** eine
   öffentliche URL erzeugen. Diese ist dann dauerhaft erreichbar.

Der Port wird von Railway über `PORT` vorgegeben – der Server übernimmt ihn
automatisch.

**Alternative ohne Datenbank:** Statt Schritt 2 ein **Volume** anlegen
(Mount-Pfad `/data`) und `DATA_DIR = /data` setzen. Dann speichert der Server
in Dateien auf dem Volume.

## Umgebungsvariablen

| Variable       | Zweck                                              | Standard        |
|----------------|----------------------------------------------------|-----------------|
| `PORT`         | Port (von Railway gesetzt)                          | `3000`          |
| `DATABASE_URL` | Postgres-Verbindung → Cloud-Speicher (von Railway)  | _leer_          |
| `DATA_DIR`     | Datei-Verzeichnis, falls keine Datenbank genutzt wird | `./data`      |
| `APP_PASSWORD` | Passwortschutz aktivieren (leer = kein Schutz)      | _leer_          |
