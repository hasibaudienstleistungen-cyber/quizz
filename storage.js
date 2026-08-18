/**
 * Speicher-Abstraktion mit zwei Backends:
 *  - Postgres (wenn DATABASE_URL gesetzt ist, z. B. Railway-Postgres) → Cloud
 *  - Dateisystem (sonst; auf Railway idealerweise ein Volume) → lokal
 *
 * Beide Backends bieten dieselbe asynchrone API.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

function newId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function buildSeedState(seedFile) {
  let seed = [];
  try { seed = JSON.parse(fs.readFileSync(seedFile, 'utf8')); } catch (e) { seed = []; }
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
  return { photos, sectionMeta, nextId, meta, version: 1, savedAt: new Date().toISOString() };
}

function normState(state) {
  return {
    photos: Array.isArray(state.photos) ? state.photos : [],
    sectionMeta: Array.isArray(state.sectionMeta) ? state.sectionMeta : [],
    nextId: typeof state.nextId === 'number' ? state.nextId : 1,
    meta: state.meta && typeof state.meta === 'object' ? state.meta : {},
    version: 1,
    savedAt: new Date().toISOString(),
  };
}

/* =========================== Postgres-Backend =========================== */
function createPgStore(seedFile) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  });

  async function init() {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS projects (' +
      ' id TEXT PRIMARY KEY,' +
      ' name TEXT NOT NULL,' +
      ' data TEXT NOT NULL DEFAULT \'{}\',' +
      ' created_at TIMESTAMPTZ DEFAULT now(),' +
      ' updated_at TIMESTAMPTZ DEFAULT now())'
    );
    await pool.query('CREATE TABLE IF NOT EXISTS app_meta (k TEXT PRIMARY KEY, v TEXT)');
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM projects');
    if (rows[0].n === 0) {
      const seedState = buildSeedState(seedFile);
      const id = newId();
      await pool.query('INSERT INTO projects (id, name, data) VALUES ($1,$2,$3)', [
        id, seedState.meta.projektTitel || 'Projekt 1', JSON.stringify(seedState),
      ]);
      await setActive(id);
    }
  }

  async function getIndex() {
    const { rows } = await pool.query('SELECT id, name FROM projects ORDER BY created_at ASC');
    const active = await pool.query("SELECT v FROM app_meta WHERE k='activeId'");
    let activeId = active.rows[0] && active.rows[0].v;
    if (!activeId || !rows.find((r) => r.id === activeId)) activeId = rows.length ? rows[0].id : null;
    return { activeId, projects: rows };
  }

  async function createProject(name) {
    const id = newId();
    const empty = normState({});
    await pool.query('INSERT INTO projects (id, name, data) VALUES ($1,$2,$3)', [id, name, JSON.stringify(empty)]);
    await setActive(id);
    return { id, index: await getIndex() };
  }

  async function renameProject(id, name) {
    await pool.query('UPDATE projects SET name=$2, updated_at=now() WHERE id=$1', [id, name]);
    return { index: await getIndex() };
  }

  async function deleteProject(id) {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM projects');
    if (rows[0].n <= 1) { const e = new Error('last_project'); e.code = 'last_project'; throw e; }
    await pool.query('DELETE FROM projects WHERE id=$1', [id]);
    const idx = await getIndex();
    await setActive(idx.projects[0].id);
    return { index: await getIndex() };
  }

  async function setActive(id) {
    await pool.query(
      "INSERT INTO app_meta (k,v) VALUES ('activeId',$1) ON CONFLICT (k) DO UPDATE SET v=$1",
      [id]
    );
  }

  async function getProject(id) {
    const { rows } = await pool.query('SELECT data FROM projects WHERE id=$1', [id]);
    if (!rows.length) return null;
    try { return JSON.parse(rows[0].data); } catch (e) { return null; }
  }

  async function saveProject(id, state) {
    const s = normState(state);
    const res = await pool.query('UPDATE projects SET data=$2, updated_at=now() WHERE id=$1', [id, JSON.stringify(s)]);
    return res.rowCount > 0;
  }

  return { kind: 'postgres', init, getIndex, createProject, renameProject, deleteProject, setActive, getProject, saveProject };
}

/* =========================== Datei-Backend ============================= */
function createFileStore(dataDir, seedFile) {
  const INDEX_FILE = path.join(dataDir, 'index.json');
  fs.mkdirSync(dataDir, { recursive: true });

  function projFile(id) {
    const safe = String(id).replace(/[^a-z0-9]/gi, '');
    return path.join(dataDir, 'proj_' + safe + '.json');
  }
  let chain = Promise.resolve();
  function atomicWrite(file, str) {
    chain = chain.then(async () => {
      const tmp = file + '.tmp';
      await fsp.writeFile(tmp, str, 'utf8');
      await fsp.rename(tmp, file);
    });
    return chain;
  }
  async function readIndexRaw() {
    try { return JSON.parse(await fsp.readFile(INDEX_FILE, 'utf8')); } catch (e) { return null; }
  }
  function writeIndex(index) { return atomicWrite(INDEX_FILE, JSON.stringify(index)); }

  async function init() {
    let index = await readIndexRaw();
    if (!index) {
      const seedState = buildSeedState(seedFile);
      const id = newId();
      await atomicWrite(projFile(id), JSON.stringify(seedState));
      index = { activeId: id, projects: [{ id, name: seedState.meta.projektTitel || 'Projekt 1' }] };
      await writeIndex(index);
    }
  }
  async function getIndex() { return (await readIndexRaw()) || { activeId: null, projects: [] }; }
  async function createProject(name) {
    const index = await getIndex();
    const id = newId();
    await atomicWrite(projFile(id), JSON.stringify(normState({})));
    index.projects.push({ id, name });
    index.activeId = id;
    await writeIndex(index);
    return { id, index };
  }
  async function renameProject(id, name) {
    const index = await getIndex();
    const p = index.projects.find((x) => x.id === id);
    if (p) p.name = name;
    await writeIndex(index);
    return { index };
  }
  async function deleteProject(id) {
    const index = await getIndex();
    if (index.projects.length <= 1) { const e = new Error('last_project'); e.code = 'last_project'; throw e; }
    index.projects = index.projects.filter((x) => x.id !== id);
    if (index.activeId === id) index.activeId = index.projects[0].id;
    await writeIndex(index);
    fsp.unlink(projFile(id)).catch(() => {});
    return { index };
  }
  async function setActive(id) {
    const index = await getIndex();
    if (index.projects.find((x) => x.id === id)) { index.activeId = id; await writeIndex(index); }
  }
  async function getProject(id) {
    try { return JSON.parse(await fsp.readFile(projFile(id), 'utf8')); } catch (e) { return null; }
  }
  async function saveProject(id, state) {
    await atomicWrite(projFile(id), JSON.stringify(normState(state)));
    return true;
  }
  return { kind: 'file', init, getIndex, createProject, renameProject, deleteProject, setActive, getProject, saveProject };
}

function createStore(opts) {
  if (process.env.DATABASE_URL) return createPgStore(opts.seedFile);
  return createFileStore(opts.dataDir, opts.seedFile);
}

module.exports = { createStore };
