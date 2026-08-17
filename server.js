/**
 * Fotodokumentation – Bildauswahl
 * Express-Server mit serverseitiger Speicherung mehrerer Projekte.
 * Jedes Projekt liegt als eigene JSON-Datei im Datenverzeichnis; ein
 * index.json hält die Projektliste und das aktive Projekt. Auf einem
 * Railway-Volume übersteht alles Neustarts und Deployments.
 */
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR =
  process.env.DATA_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  path.join(__dirname, 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const SEED_FILE = path.join(__dirname, 'data', 'seed.json');
const APP_PASSWORD = process.env.APP_PASSWORD || '';

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '60mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Passwortschutz (optional) -------------------------------------------
function checkAuth(req, res, next) {
  if (!APP_PASSWORD) return next();
  if ((req.get('x-app-password') || '') === APP_PASSWORD) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// ---- Hilfsfunktionen -----------------------------------------------------
function newId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function projFile(id) {
  // id ist serverseitig erzeugt (kein Pfadtrenner); zusätzlich absichern:
  const safe = String(id).replace(/[^a-z0-9]/gi, '');
  return path.join(DATA_DIR, 'proj_' + safe + '.json');
}

// Atomare, serialisierte Schreibvorgänge.
let writeChain = Promise.resolve();
function atomicWrite(file, dataStr) {
  writeChain = writeChain.then(async () => {
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, dataStr, 'utf8');
    await fsp.rename(tmp, file);
  });
  return writeChain;
}

function buildSeedState() {
  let seed = [];
  try { seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')); } catch (e) { seed = []; }
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
  const meta = {
    titel: 'Fotodokumentation',
    firma: 'Schärli Architektur AG',
    projektTitel: '1452.0 Neubau Wohnhaus Leumattstrasse 33, Luzern',
    thema: 'Zustandsdokumentation Bestand / Umgebung vor Baubeginn',
    datum: '3. – 16. August 2026',
    aufgenommenDurch: 'meha',
  };
  return { photos, sectionMeta, nextId, meta };
}

async function readIndex() {
  try {
    return JSON.parse(await fsp.readFile(INDEX_FILE, 'utf8'));
  } catch (e) {
    // Erstinitialisierung: erstes Projekt aus seed.json.
    const id = newId();
    const seedState = buildSeedState();
    await atomicWrite(projFile(id), JSON.stringify({ ...seedState, version: 1, savedAt: new Date().toISOString() }));
    const index = { activeId: id, projects: [{ id, name: seedState.meta.projektTitel || 'Projekt 1' }] };
    await atomicWrite(INDEX_FILE, JSON.stringify(index));
    return index;
  }
}
function writeIndex(index) { return atomicWrite(INDEX_FILE, JSON.stringify(index)); }

async function readProject(id) {
  try { return JSON.parse(await fsp.readFile(projFile(id), 'utf8')); }
  catch (e) { return null; }
}

// ---- API: Projekte -------------------------------------------------------
app.get('/api/projects', checkAuth, async (req, res) => {
  try { res.json(await readIndex()); }
  catch (e) { res.status(500).json({ error: 'read_failed' }); }
});

app.post('/api/projects', checkAuth, async (req, res) => {
  try {
    const index = await readIndex();
    const name = (req.body && typeof req.body.name === 'string' && req.body.name.trim()) || 'Neues Projekt';
    const id = newId();
    const empty = { photos: [], sectionMeta: [], nextId: 1, meta: {}, version: 1, savedAt: new Date().toISOString() };
    await atomicWrite(projFile(id), JSON.stringify(empty));
    index.projects.push({ id, name });
    index.activeId = id;
    await writeIndex(index);
    res.json({ id, index });
  } catch (e) { res.status(500).json({ error: 'create_failed' }); }
});

app.put('/api/projects/:id', checkAuth, async (req, res) => {
  try {
    const index = await readIndex();
    const p = index.projects.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    if (req.body && typeof req.body.name === 'string' && req.body.name.trim()) p.name = req.body.name.trim();
    await writeIndex(index);
    res.json({ index });
  } catch (e) { res.status(500).json({ error: 'rename_failed' }); }
});

app.delete('/api/projects/:id', checkAuth, async (req, res) => {
  try {
    const index = await readIndex();
    if (index.projects.length <= 1) return res.status(400).json({ error: 'last_project' });
    if (!index.projects.find((x) => x.id === req.params.id)) return res.status(404).json({ error: 'not_found' });
    index.projects = index.projects.filter((x) => x.id !== req.params.id);
    if (index.activeId === req.params.id) index.activeId = index.projects[0].id;
    await writeIndex(index);
    fsp.unlink(projFile(req.params.id)).catch(() => {});
    res.json({ index });
  } catch (e) { res.status(500).json({ error: 'delete_failed' }); }
});

app.post('/api/active', checkAuth, async (req, res) => {
  try {
    const index = await readIndex();
    const id = req.body && req.body.id;
    if (!index.projects.find((x) => x.id === id)) return res.status(404).json({ error: 'not_found' });
    index.activeId = id;
    await writeIndex(index);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'active_failed' }); }
});

// ---- API: Projekt-Zustand ------------------------------------------------
app.get('/api/state/:id', checkAuth, async (req, res) => {
  try {
    const state = await readProject(req.params.id);
    if (!state) return res.status(404).json({ error: 'not_found' });
    res.json(state);
  } catch (e) { res.status(500).json({ error: 'read_failed' }); }
});

app.post('/api/state/:id', checkAuth, async (req, res) => {
  try {
    const { photos, sectionMeta, nextId, meta } = req.body || {};
    if (!Array.isArray(photos) || !Array.isArray(sectionMeta)) {
      return res.status(400).json({ error: 'invalid_state' });
    }
    const state = {
      photos,
      sectionMeta,
      nextId: typeof nextId === 'number' ? nextId : 1,
      meta: meta && typeof meta === 'object' ? meta : {},
      version: 1,
      savedAt: new Date().toISOString(),
    };
    await atomicWrite(projFile(req.params.id), JSON.stringify(state));
    res.json({ ok: true, savedAt: state.savedAt });
  } catch (e) { res.status(500).json({ error: 'write_failed' }); }
});

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Fotodokumentation läuft auf Port ${PORT}`);
  console.log(`Datenverzeichnis: ${DATA_DIR}`);
  console.log(`Passwortschutz: ${APP_PASSWORD ? 'aktiv' : 'aus'}`);
});
