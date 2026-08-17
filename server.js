/**
 * Fotodokumentation – Bildauswahl
 * Kleiner Express-Server, der die App ausliefert und den Bearbeitungsstand
 * serverseitig in einer JSON-Datei speichert. Liegt die Datei auf einem
 * Railway-Volume, übersteht der Stand Neustarts und Deployments.
 */
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Datenverzeichnis: auf Railway ein gemountetes Volume (RAILWAY_VOLUME_MOUNT_PATH),
// lokal ein ./data-Ordner.
const DATA_DIR =
  process.env.DATA_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SEED_FILE = path.join(__dirname, 'data', 'seed.json');

const APP_PASSWORD = process.env.APP_PASSWORD || '';

fs.mkdirSync(DATA_DIR, { recursive: true });

// JSON-Bodies können durch eingebettete Bilder groß werden.
app.use(express.json({ limit: '60mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Passwortschutz (optional) -------------------------------------------
function checkAuth(req, res, next) {
  if (!APP_PASSWORD) return next();
  const provided = req.get('x-app-password') || '';
  if (provided === APP_PASSWORD) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// ---- Startzustand aus seed.json aufbauen ---------------------------------
function buildInitialState() {
  let seed = [];
  try {
    seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  } catch (e) {
    seed = [];
  }
  const photos = seed.map((p) => ({ ...p, removed: false, isNew: false }));
  const sectionMeta = [];
  const seen = new Set();
  photos.forEach((p) => {
    if (!seen.has(p.section)) {
      seen.add(p.section);
      sectionMeta.push({ nr: p.section, title: p.sectionTitle, removed: false });
    }
  });
  const nextId = photos.length ? Math.max(...photos.map((p) => p.id)) + 1 : 1;
  return { photos, sectionMeta, nextId, version: 1, savedAt: new Date().toISOString() };
}

async function readState() {
  try {
    const raw = await fsp.readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    // Noch kein gespeicherter Stand -> mit den Ausgangsfotos initialisieren.
    const initial = buildInitialState();
    await writeState(initial);
    return initial;
  }
}

// Atomar schreiben: erst in eine temporäre Datei, dann umbenennen.
let writeChain = Promise.resolve();
function writeState(state) {
  writeChain = writeChain.then(async () => {
    const tmp = STATE_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(state), 'utf8');
    await fsp.rename(tmp, STATE_FILE);
  });
  return writeChain;
}

// ---- API -----------------------------------------------------------------
app.get('/api/state', checkAuth, async (req, res) => {
  try {
    const state = await readState();
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: 'read_failed' });
  }
});

app.post('/api/state', checkAuth, async (req, res) => {
  try {
    const { photos, sectionMeta, nextId } = req.body || {};
    if (!Array.isArray(photos) || !Array.isArray(sectionMeta)) {
      return res.status(400).json({ error: 'invalid_state' });
    }
    const state = {
      photos,
      sectionMeta,
      nextId: typeof nextId === 'number' ? nextId : 1,
      version: 1,
      savedAt: new Date().toISOString(),
    };
    await writeState(state);
    res.json({ ok: true, savedAt: state.savedAt });
  } catch (e) {
    res.status(500).json({ error: 'write_failed' });
  }
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Fotodokumentation läuft auf Port ${PORT}`);
  console.log(`Datenverzeichnis: ${DATA_DIR}`);
  console.log(`Passwortschutz: ${APP_PASSWORD ? 'aktiv' : 'aus'}`);
});
