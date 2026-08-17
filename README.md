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

Der Server legt jedes Projekt als eigene Datei (`proj_<id>.json`) im
Datenverzeichnis ab; `index.json` hält die Projektliste und das aktive Projekt.
Auf Railway liegt dieses Verzeichnis auf einem **Volume**, damit alles Neustarts
und neue Deployments übersteht. Beim allerersten Start wird ein erstes Projekt
aus `data/seed.json` (den mitgelieferten 43 Fotos) aufgebaut.

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

## Deployment auf Railway

1. Auf [railway.app](https://railway.app) einloggen → **New Project** →
   **Deploy from GitHub repo** → dieses Repository und den Branch auswählen.
2. Railway erkennt Node.js automatisch und startet mit `npm start`.
3. **Volume anlegen** (wichtig, sonst geht der Stand bei jedem Deploy verloren):
   Im Service → **Variables/Settings** → **+ Volume** → Mount-Pfad z. B.
   `/data`.
4. **Environment-Variable setzen:** `DATA_DIR = /data` (gleicher Pfad wie das
   Volume). Alternativ nutzt der Server automatisch `RAILWAY_VOLUME_MOUNT_PATH`,
   falls gesetzt.
5. Optional: `APP_PASSWORD = deinPasswort` setzen, um die App zu schützen.
6. Unter **Settings → Networking → Generate Domain** eine öffentliche URL
   erzeugen. Diese URL ist dann dauerhaft erreichbar.

Der Port wird von Railway über die `PORT`-Variable vorgegeben – der Server
übernimmt sie automatisch.

## Umgebungsvariablen

| Variable       | Zweck                                              | Standard        |
|----------------|----------------------------------------------------|-----------------|
| `PORT`         | Port (von Railway gesetzt)                          | `3000`          |
| `DATA_DIR`     | Verzeichnis für `state.json` (auf das Volume legen) | `./data`        |
| `APP_PASSWORD` | Passwortschutz aktivieren (leer = kein Schutz)      | _leer_          |
