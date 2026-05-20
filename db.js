const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Carregar .env local se existir (não é commitado)
try {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch (e) { /* .env ausente é normal em produção */ }

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fluxograma';
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
const sslDisabled = /sslmode=disable/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: (isLocal || sslDisabled) ? false : { rejectUnauthorized: false },
});

async function init() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        email    TEXT PRIMARY KEY,
        name     TEXT NOT NULL DEFAULT '',
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT PRIMARY KEY,
        email      TEXT NOT NULL,
        name       TEXT NOT NULL DEFAULT '',
        is_admin   BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS live_doc (
        id         INTEGER PRIMARY KEY DEFAULT 1,
        data       JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS published_flows (
        slug       TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS backups (
        filename   TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS images (
        filename   TEXT PRIMARY KEY,
        mimetype   TEXT NOT NULL DEFAULT 'image/jpeg',
        data       TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS access_requests (
        id              SERIAL PRIMARY KEY,
        node_id         TEXT NOT NULL,
        node_title      TEXT NOT NULL DEFAULT '',
        requester_email TEXT NOT NULL,
        requester_name  TEXT NOT NULL DEFAULT '',
        status          TEXT NOT NULL DEFAULT 'pending',
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        resolved_at     TIMESTAMPTZ,
        resolved_by     TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id          SERIAL PRIMARY KEY,
        actor_email TEXT NOT NULL,
        action      TEXT NOT NULL,
        target      TEXT,
        description TEXT NOT NULL,
        metadata    JSONB,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_email);
    `);
    // Migration: add metadata column to existing tables
    await client.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata JSONB`);

    // Remover sessões com mais de 1 ano
    await client.query(`DELETE FROM sessions WHERE created_at < NOW() - INTERVAL '1 year'`);

    await _migrateFromFiles(client);
    console.log('>>> DB: schema inicializado');
  } finally {
    client.release();
  }
}

async function _migrateFromFiles(client) {
  // Sessões: sempre tenta importar sessions.json (ON CONFLICT DO NOTHING é idempotente)
  const sessionsFile = path.join(__dirname, 'data', 'sessions.json');
  if (fs.existsSync(sessionsFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
      let count = 0;
      for (const [token, info] of Object.entries(raw)) {
        const r = await client.query(
          'INSERT INTO sessions (token, email, name, is_admin) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [token, info.email, info.name || '', info.isAdmin || false]
        );
        count += r.rowCount;
      }
      if (count > 0) console.log(`>>> DB: ${count} sessão(ões) importada(s) de sessions.json`);
    } catch (e) { console.log('>>> DB: erro ao importar sessions.json:', e.message); }
  }

  // Usuários
  const { rowCount: uc } = await client.query('SELECT 1 FROM users LIMIT 1');
  if (!uc) {
    const usersFile = path.join(__dirname, 'data', 'users.json');
    if (fs.existsSync(usersFile)) {
      try {
        const { admins = [], users = [] } = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
        for (const u of users) {
          await client.query(
            'INSERT INTO users (email, name, is_admin) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [u.email, u.name || '', admins.includes(u.email)]
          );
        }
        console.log('>>> DB: usuários migrados de users.json');
      } catch (e) { console.log('>>> DB: erro ao migrar users.json:', e.message); }
    }
    // Garantir admin padrão
    const { rowCount } = await client.query('SELECT 1 FROM users LIMIT 1');
    if (!rowCount) {
      await client.query(
        'INSERT INTO users (email, name, is_admin) VALUES ($1, $2, TRUE)',
        ['lincoln.maxwel@paschoini.adv.br', 'Lincoln Maxwel']
      );
    }
  }

  // Live doc
  const { rowCount: dc } = await client.query('SELECT 1 FROM live_doc LIMIT 1');
  if (!dc) {
    const liveFile = path.join(__dirname, 'data', 'live.json');
    const defaultFile = path.join(__dirname, 'default-flow.json');
    const src = fs.existsSync(liveFile) ? liveFile : fs.existsSync(defaultFile) ? defaultFile : null;
    if (src) {
      try {
        const data = JSON.parse(fs.readFileSync(src, 'utf8'));
        await client.query(
          'INSERT INTO live_doc (id, data) VALUES (1, $1) ON CONFLICT DO NOTHING',
          [JSON.stringify(data)]
        );
        console.log('>>> DB: live doc migrado de', path.basename(src));
      } catch (e) { console.log('>>> DB: erro ao migrar live doc:', e.message); }
    }
  }

  // Fluxos publicados
  const { rowCount: pc } = await client.query('SELECT 1 FROM published_flows LIMIT 1');
  if (!pc) {
    const publishedDir = path.join(__dirname, 'published');
    if (fs.existsSync(publishedDir)) {
      const files = fs.readdirSync(publishedDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const slug = file.replace('.json', '');
          const data = JSON.parse(fs.readFileSync(path.join(publishedDir, file), 'utf8'));
          await client.query(
            'INSERT INTO published_flows (slug, data) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [slug, JSON.stringify(data)]
          );
        } catch (e) { /* ignora arquivo corrompido */ }
      }
      if (files.length) console.log('>>> DB:', files.length, 'fluxo(s) publicado(s) migrado(s)');
    }
  }

  // Backups
  const { rowCount: bc } = await client.query('SELECT 1 FROM backups LIMIT 1');
  if (!bc) {
    const backupDir = path.join(__dirname, 'backup');
    if (fs.existsSync(backupDir)) {
      const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(backupDir, file), 'utf8'));
          const { mtime } = fs.statSync(path.join(backupDir, file));
          await client.query(
            'INSERT INTO backups (filename, data, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [file, JSON.stringify(data), mtime]
          );
        } catch (e) { /* ignora arquivo corrompido */ }
      }
      if (files.length) console.log('>>> DB:', files.length, 'backup(s) migrado(s)');
    }
  }

  // Imagens locais → banco (sempre, idempotente)
  const imagesDir = path.join(__dirname, 'data', 'images');
  if (fs.existsSync(imagesDir)) {
    const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
                   gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
    const files = fs.readdirSync(imagesDir).filter(f => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f));
    let count = 0;
    for (const file of files) {
      try {
        const ext = file.split('.').pop().toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        const b64 = fs.readFileSync(path.join(imagesDir, file)).toString('base64');
        const r = await client.query(
          'INSERT INTO images (filename, mimetype, data) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [file, mime, b64]
        );
        count += r.rowCount;
      } catch (e) { /* ignora arquivo corrompido */ }
    }
    if (count > 0) console.log('>>> DB:', count, 'imagem(ns) migrada(s) de data/images/');
  }
}

// ── Usuários ──────────────────────────────────────────────────────────────────

async function loadUsers() {
  const { rows } = await pool.query('SELECT email, name, is_admin FROM users ORDER BY created_at');
  return {
    admins: rows.filter(r => r.is_admin).map(r => r.email),
    users:  rows.map(r => ({ email: r.email, name: r.name })),
  };
}

async function saveUsers({ admins, users }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM users');
    for (const u of users) {
      await client.query(
        'INSERT INTO users (email, name, is_admin) VALUES ($1, $2, $3)',
        [u.email, u.name || u.email.split('@')[0], admins.includes(u.email)]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Sessões ───────────────────────────────────────────────────────────────────

async function getSessionByToken(token) {
  if (!token) return null;
  try {
    const { rows } = await pool.query(
      'SELECT email, name, is_admin FROM sessions WHERE token=$1', [token]
    );
    if (!rows.length) return null;
    return { email: rows[0].email, name: rows[0].name, isAdmin: rows[0].is_admin };
  } catch (e) { return null; }
}

async function setSession(token, { email, name, isAdmin }) {
  await pool.query(
    `INSERT INTO sessions (token, email, name, is_admin)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (token) DO UPDATE SET email=$2, name=$3, is_admin=$4`,
    [token, email, name, isAdmin]
  );
}

async function updateSessionAdmins(adminEmails) {
  await pool.query(
    'UPDATE sessions SET is_admin = (email = ANY($1::text[]))',
    [adminEmails]
  );
}

async function revokeDeletedUserSessions(activeEmails) {
  await pool.query(
    'DELETE FROM sessions WHERE email != ALL($1::text[])',
    [activeEmails]
  );
}

// ── Live doc ──────────────────────────────────────────────────────────────────

async function loadLiveDoc() {
  try {
    const { rows } = await pool.query('SELECT data FROM live_doc WHERE id=1');
    if (rows.length) return rows[0].data;
    const defaultFile = path.join(__dirname, 'default-flow.json');
    if (fs.existsSync(defaultFile)) return JSON.parse(fs.readFileSync(defaultFile, 'utf8'));
    return null;
  } catch (e) { return null; }
}

async function saveLiveDoc(data) {
  await pool.query(
    `INSERT INTO live_doc (id, data, updated_at) VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET data=$1, updated_at=NOW()`,
    [JSON.stringify(data)]
  );
}

// ── Fluxos publicados ─────────────────────────────────────────────────────────

async function loadPublished(slug) {
  const { rows } = await pool.query('SELECT data FROM published_flows WHERE slug=$1', [slug]);
  return rows.length ? rows[0].data : null;
}

async function savePublished(slug, data) {
  await pool.query(
    `INSERT INTO published_flows (slug, data, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (slug) DO UPDATE SET data=$2, updated_at=NOW()`,
    [slug, JSON.stringify(data)]
  );
}

async function publishedExists(slug) {
  const { rows } = await pool.query('SELECT 1 FROM published_flows WHERE slug=$1', [slug]);
  return rows.length > 0;
}

async function getLastPublishedSlug() {
  const { rows } = await pool.query('SELECT slug FROM published_flows ORDER BY updated_at DESC LIMIT 1');
  return rows[0]?.slug || null;
}

// ── Solicitações de acesso ────────────────────────────────────────────────────

async function createAccessRequest(nodeId, nodeTitle, requesterEmail, requesterName) {
  const existing = await pool.query(
    'SELECT id, status FROM access_requests WHERE node_id=$1 AND requester_email=$2 AND status=$3',
    [nodeId, requesterEmail, 'pending']
  );
  if (existing.rows.length > 0) return { id: existing.rows[0].id, alreadyExists: true };
  const { rows } = await pool.query(
    'INSERT INTO access_requests (node_id, node_title, requester_email, requester_name) VALUES ($1,$2,$3,$4) RETURNING id',
    [nodeId, nodeTitle, requesterEmail, requesterName]
  );
  return { id: rows[0].id, alreadyExists: false };
}

async function listAccessRequests(status = 'pending') {
  const { rows } = await pool.query(
    'SELECT * FROM access_requests WHERE status=$1 ORDER BY created_at DESC',
    [status]
  );
  return rows;
}

async function resolveAccessRequest(id, status, resolvedBy) {
  const { rows } = await pool.query(
    'UPDATE access_requests SET status=$1, resolved_at=NOW(), resolved_by=$2 WHERE id=$3 RETURNING *',
    [status, resolvedBy, id]
  );
  return rows[0] || null;
}

async function getMyAccessRequests(email) {
  const { rows } = await pool.query(
    'SELECT node_id, status FROM access_requests WHERE requester_email=$1 ORDER BY created_at DESC',
    [email]
  );
  // Retorna mapa nodeId → status mais recente
  const map = {};
  for (const r of rows) {
    if (!map[r.node_id]) map[r.node_id] = r.status;
  }
  return map;
}

// ── Imagens ───────────────────────────────────────────────────────────────────

async function saveImage(filename, mimetype, base64data) {
  await pool.query(
    `INSERT INTO images (filename, mimetype, data) VALUES ($1, $2, $3)
     ON CONFLICT (filename) DO UPDATE SET data=$3, mimetype=$2`,
    [filename, mimetype, base64data]
  );
}

async function loadImage(filename) {
  const { rows } = await pool.query('SELECT mimetype, data FROM images WHERE filename=$1', [filename]);
  return rows.length ? rows[0] : null;
}

// ── Backups ───────────────────────────────────────────────────────────────────

async function listBackups() {
  const { rows } = await pool.query(
    'SELECT filename, created_at, length(data::text) AS size FROM backups ORDER BY created_at DESC'
  );
  return rows.map(r => ({ filename: r.filename, size: parseInt(r.size, 10), mtime: r.created_at }));
}

async function saveBackup(filename, data) {
  await pool.query(
    `INSERT INTO backups (filename, data) VALUES ($1, $2)
     ON CONFLICT (filename) DO UPDATE SET data=$2`,
    [filename, JSON.stringify(data)]
  );
}

async function loadBackup(filename) {
  const { rows } = await pool.query('SELECT data FROM backups WHERE filename=$1', [filename]);
  return rows.length ? rows[0].data : null;
}

// ── Auditoria ─────────────────────────────────────────────────────────────────

async function logAudit(actorEmail, action, description, target = null, metadata = null) {
  try {
    await pool.query(
      'INSERT INTO audit_logs (actor_email, action, description, target, metadata) VALUES ($1, $2, $3, $4, $5)',
      [actorEmail, action, description, target, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (e) { console.error('logAudit error:', e.message); }
}

async function batchLogAudit(actorEmail, entries) {
  if (!entries || entries.length === 0) return;
  try {
    for (const e of entries) {
      await pool.query(
        'INSERT INTO audit_logs (actor_email, action, description, target, metadata) VALUES ($1, $2, $3, $4, $5)',
        [actorEmail, e.action, e.description, e.target || null, e.metadata ? JSON.stringify(e.metadata) : null]
      );
    }
  } catch (e) { console.error('batchLogAudit error:', e.message); }
}

async function getAuditLogs({ from, to, user, action, limit = 100, offset = 0 } = {}) {
  try {
    const conds = [], params = [];
    let p = 1;
    if (from)   { conds.push(`created_at >= $${p++}`); params.push(from); }
    if (to)     { conds.push(`created_at <  $${p++}`); params.push(to); }
    if (user)   { conds.push(`actor_email ILIKE $${p++}`); params.push(`%${user}%`); }
    if (action) { conds.push(`action LIKE $${p++}`); params.push(action + '%'); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const lim = Math.min(Number(limit) || 100, 500);
    const off = Number(offset) || 0;
    const { rows } = await pool.query(
      `SELECT id, actor_email, action, target, description, metadata, created_at
       FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${p} OFFSET $${p + 1}`,
      [...params, lim, off]
    );
    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*) FROM audit_logs ${where}`, params
    );
    return { logs: rows, total: parseInt(count, 10) };
  } catch (e) { console.error('getAuditLogs error:', e.message); return { logs: [], total: 0 }; }
}

async function clearAuditLogs() {
  try {
    await pool.query('TRUNCATE TABLE audit_logs RESTART IDENTITY');
    return { ok: true };
  } catch (e) { console.error('clearAuditLogs error:', e.message); return { ok: false, error: e.message }; }
}

async function deleteAuditLog(id) {
  try {
    const { rowCount } = await pool.query('DELETE FROM audit_logs WHERE id = $1', [id]);
    return { ok: true, deleted: rowCount > 0 };
  } catch (e) { console.error('deleteAuditLog error:', e.message); return { ok: false, error: e.message }; }
}

async function getDbStatus() {
  try {
    const [docRow, backupRow, auditRow, userRow, imgRow] = await Promise.all([
      pool.query(`SELECT updated_at,
                         jsonb_array_length(data->'nodes') AS node_count,
                         jsonb_array_length(data->'edges') AS edge_count,
                         (SELECT count(*) FROM jsonb_object_keys(data->'subflows')) AS subflow_count,
                         pg_size_pretty(length(data::text)::bigint) AS doc_size
                  FROM live_doc WHERE id = 1`),
      pool.query(`SELECT COUNT(*) AS total FROM backups`),
      pool.query(`SELECT COUNT(*) AS total FROM audit_logs`),
      pool.query(`SELECT COUNT(*) AS total FROM users`),
      pool.query(`SELECT COUNT(*) AS total FROM images`),
    ]);
    const doc = docRow.rows[0] || {};
    return {
      ok: true,
      live_doc: {
        last_save:     doc.updated_at || null,
        node_count:    parseInt(doc.node_count  || 0, 10),
        edge_count:    parseInt(doc.edge_count  || 0, 10),
        subflow_count: parseInt(doc.subflow_count || 0, 10),
        doc_size:      doc.doc_size || '0 bytes',
      },
      counts: {
        backups:    parseInt(backupRow.rows[0].total, 10),
        audit_logs: parseInt(auditRow.rows[0].total, 10),
        users:      parseInt(userRow.rows[0].total, 10),
        images:     parseInt(imgRow.rows[0].total, 10),
      },
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = {
  init, pool,
  loadUsers, saveUsers,
  getSessionByToken, setSession, updateSessionAdmins, revokeDeletedUserSessions,
  loadLiveDoc, saveLiveDoc,
  loadPublished, savePublished, publishedExists, getLastPublishedSlug,
  listBackups, saveBackup, loadBackup,
  saveImage, loadImage,
  createAccessRequest, listAccessRequests, resolveAccessRequest, getMyAccessRequests,
  logAudit, batchLogAudit, getAuditLogs, clearAuditLogs, deleteAuditLog, getDbStatus,
};
