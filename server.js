/**
 * Fotodokumentation – Bildauswahl
 * Express-Server mit mehreren Projekten. Speicherung wahlweise in einer
 * Cloud-Datenbank (Postgres via DATABASE_URL, z. B. Railway-Postgres) oder
 * im Dateisystem/Volume. Siehe storage.js.
 */
const express = require('express');
const path = require('path');
const { createStore } = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || '';

const DATA_DIR =
  process.env.DATA_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  path.join(__dirname, 'data');
const SEED_FILE = path.join(__dirname, 'data', 'seed.json');

const store = createStore({ dataDir: DATA_DIR, seedFile: SEED_FILE });

app.use(express.json({ limit: '80mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function checkAuth(req, res, next) {
  if (!APP_PASSWORD) return next();
  if ((req.get('x-app-password') || '') === APP_PASSWORD) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// ---- Projekte ------------------------------------------------------------
app.get('/api/projects', checkAuth, async (req, res) => {
  try { res.json(await store.getIndex()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'read_failed' }); }
});

app.post('/api/projects', checkAuth, async (req, res) => {
  try {
    const name = (req.body && typeof req.body.name === 'string' && req.body.name.trim()) || 'Neues Projekt';
    res.json(await store.createProject(name));
  } catch (e) { console.error(e); res.status(500).json({ error: 'create_failed' }); }
});

app.put('/api/projects/:id', checkAuth, async (req, res) => {
  try {
    const name = req.body && typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'invalid_name' });
    res.json(await store.renameProject(req.params.id, name));
  } catch (e) { console.error(e); res.status(500).json({ error: 'rename_failed' }); }
});

app.delete('/api/projects/:id', checkAuth, async (req, res) => {
  try { res.json(await store.deleteProject(req.params.id)); }
  catch (e) {
    if (e && e.code === 'last_project') return res.status(400).json({ error: 'last_project' });
    console.error(e); res.status(500).json({ error: 'delete_failed' });
  }
});

app.post('/api/active', checkAuth, async (req, res) => {
  try { await store.setActive(req.body && req.body.id); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'active_failed' }); }
});

// ---- Projekt-Zustand -----------------------------------------------------
app.get('/api/state/:id', checkAuth, async (req, res) => {
  try {
    const state = await store.getProject(req.params.id);
    if (!state) return res.status(404).json({ error: 'not_found' });
    res.json(state);
  } catch (e) { console.error(e); res.status(500).json({ error: 'read_failed' }); }
});

app.post('/api/state/:id', checkAuth, async (req, res) => {
  try {
    const { photos, sectionMeta } = req.body || {};
    if (!Array.isArray(photos) || !Array.isArray(sectionMeta)) {
      return res.status(400).json({ error: 'invalid_state' });
    }
    const ok = await store.saveProject(req.params.id, req.body);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'write_failed' }); }
});

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/healthz', (req, res) => res.json({ ok: true }));

store.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Fotodokumentation läuft auf Port ${PORT}`);
      console.log(`Speicher: ${store.kind === 'postgres' ? 'Cloud-Datenbank (Postgres)' : 'Dateien in ' + DATA_DIR}`);
      console.log(`Passwortschutz: ${APP_PASSWORD ? 'aktiv' : 'aus'}`);
    });
  })
  .catch((e) => {
    console.error('Start fehlgeschlagen:', e);
    process.exit(1);
  });
