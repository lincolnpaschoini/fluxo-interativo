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

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
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
    `);

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

module.exports = {
  init, pool,
  loadUsers, saveUsers,
  getSessionByToken, setSession, updateSessionAdmins,
  loadLiveDoc, saveLiveDoc,
  loadPublished, savePublished, publishedExists,
  listBackups, saveBackup, loadBackup,
};
