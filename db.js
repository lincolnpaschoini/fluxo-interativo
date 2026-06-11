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
      CREATE TABLE IF NOT EXISTS environments (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        logo       TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        created_by TEXT
      );
      CREATE TABLE IF NOT EXISTS user_environments (
        email          TEXT NOT NULL,
        environment_id INTEGER NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
        PRIMARY KEY (email, environment_id)
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
    await client.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata JSONB`);

    // ── Multi-ambientes: migrações idempotentes ─────────────────────────────
    await client.query(`ALTER TABLE live_doc          ADD COLUMN IF NOT EXISTS environment_id INTEGER`);
    await client.query(`ALTER TABLE published_flows   ADD COLUMN IF NOT EXISTS environment_id INTEGER`);
    await client.query(`ALTER TABLE backups           ADD COLUMN IF NOT EXISTS environment_id INTEGER`);
    await client.query(`ALTER TABLE access_requests   ADD COLUMN IF NOT EXISTS environment_id INTEGER`);
    await client.query(`ALTER TABLE audit_logs        ADD COLUMN IF NOT EXISTS environment_id INTEGER`);
    await client.query(`ALTER TABLE sessions          ADD COLUMN IF NOT EXISTS current_environment_id INTEGER`);

    const { rowCount: envCount } = await client.query('SELECT 1 FROM environments LIMIT 1');
    if (!envCount) {
      await client.query(
        `INSERT INTO environments (id, name, logo, created_by) VALUES (1, 'Empresa Principal', NULL, 'system')`
      );
      await client.query(`SELECT setval('environments_id_seq', GREATEST(1, (SELECT COALESCE(MAX(id),1) FROM environments)))`);
    }

    await client.query(`UPDATE live_doc        SET environment_id = 1 WHERE environment_id IS NULL`);
    await client.query(`UPDATE published_flows SET environment_id = 1 WHERE environment_id IS NULL`);
    await client.query(`UPDATE backups         SET environment_id = 1 WHERE environment_id IS NULL`);
    await client.query(`UPDATE access_requests SET environment_id = 1 WHERE environment_id IS NULL`);

    const { rows: pkRows } = await client.query(`
      SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'live_doc'::regclass AND i.indisprimary
    `);
    const pkCols = pkRows.map(r => r.attname);
    if (pkCols.length === 1 && pkCols[0] === 'id') {
      await client.query(`ALTER TABLE live_doc DROP CONSTRAINT live_doc_pkey`);
      await client.query(`ALTER TABLE live_doc ALTER COLUMN environment_id SET NOT NULL`);
      await client.query(`ALTER TABLE live_doc ADD CONSTRAINT live_doc_pkey PRIMARY KEY (environment_id)`);
      try { await client.query(`ALTER TABLE live_doc DROP COLUMN id`); } catch (_) {}
    }

    await client.query(`
      INSERT INTO user_environments (email, environment_id)
      SELECT email, 1 FROM users
      WHERE NOT EXISTS (SELECT 1 FROM user_environments ue WHERE ue.email = users.email)
      ON CONFLICT DO NOTHING
    `);

    await client.query(`UPDATE sessions SET current_environment_id = 1 WHERE current_environment_id IS NULL`);

    // published_flows: PK passa de (slug) para (slug, environment_id) para permitir o mesmo slug em ambientes diferentes
    const { rows: pubPkRows } = await client.query(`
      SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'published_flows'::regclass AND i.indisprimary
    `);
    const pubPkCols = pubPkRows.map(r => r.attname).sort();
    if (!(pubPkCols.length === 2 && pubPkCols[0] === 'environment_id' && pubPkCols[1] === 'slug')) {
      try { await client.query(`ALTER TABLE published_flows DROP CONSTRAINT published_flows_pkey`); } catch (_) {}
      await client.query(`ALTER TABLE published_flows ALTER COLUMN environment_id SET NOT NULL`);
      await client.query(`ALTER TABLE published_flows ADD CONSTRAINT published_flows_pkey PRIMARY KEY (slug, environment_id)`);
    }

    // backups: PK passa de (filename) para (filename, environment_id).
    // Sem isso, um backup com o mesmo nome (ex.: auto.json) era UMA linha global compartilhada
    // entre todos os ambientes — cada sync de um ambiente "roubava" o backup do outro,
    // perdendo o ponto de recuperacao e servindo dados de ambiente errado.
    const { rows: bkpPkRows } = await client.query(`
      SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'backups'::regclass AND i.indisprimary
    `);
    const bkpPkCols = bkpPkRows.map(r => r.attname).sort();
    if (!(bkpPkCols.length === 2 && bkpPkCols[0] === 'environment_id' && bkpPkCols[1] === 'filename')) {
      try { await client.query(`ALTER TABLE backups DROP CONSTRAINT backups_pkey`); } catch (_) {}
      await client.query(`ALTER TABLE backups ALTER COLUMN environment_id SET NOT NULL`);
      await client.query(`ALTER TABLE backups ADD CONSTRAINT backups_pkey PRIMARY KEY (filename, environment_id)`);
    }

    await client.query(`CREATE INDEX IF NOT EXISTS published_flows_env_idx ON published_flows (environment_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS published_flows_slug_idx ON published_flows (slug)`);
    await client.query(`CREATE INDEX IF NOT EXISTS backups_env_idx          ON backups (environment_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS access_requests_env_idx  ON access_requests (environment_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS audit_logs_env_idx       ON audit_logs (environment_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS user_environments_email_idx ON user_environments (email)`);

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
          'INSERT INTO live_doc (environment_id, data) VALUES (1, $1) ON CONFLICT DO NOTHING',
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
            'INSERT INTO published_flows (slug, environment_id, data) VALUES ($1, 1, $2) ON CONFLICT DO NOTHING',
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
            'INSERT INTO backups (filename, environment_id, data, created_at) VALUES ($1, 1, $2, $3) ON CONFLICT DO NOTHING',
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
  const { rows: ueRows } = await pool.query('SELECT email, environment_id FROM user_environments');
  const userEnvMap = {};
  for (const r of ueRows) {
    (userEnvMap[r.email] = userEnvMap[r.email] || []).push(r.environment_id);
  }
  return {
    admins: rows.filter(r => r.is_admin).map(r => r.email),
    users:  rows.map(r => ({
      email: r.email,
      name:  r.name,
      environments: userEnvMap[r.email] || [],
    })),
  };
}

async function saveUsers({ admins, users }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM users');
    await client.query('DELETE FROM user_environments');
    for (const u of users) {
      await client.query(
        'INSERT INTO users (email, name, is_admin) VALUES ($1, $2, $3)',
        [u.email, u.name || u.email.split('@')[0], admins.includes(u.email)]
      );
      const envs = Array.isArray(u.environments) ? u.environments : [];
      for (const envId of envs) {
        await client.query(
          'INSERT INTO user_environments (email, environment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [u.email, envId]
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Ambientes ─────────────────────────────────────────────────────────────────

async function listEnvironments() {
  const { rows } = await pool.query(
    'SELECT id, name, logo, created_at, created_by FROM environments ORDER BY id'
  );
  return rows;
}

async function getEnvironment(id) {
  const { rows } = await pool.query(
    'SELECT id, name, logo, created_at, created_by FROM environments WHERE id=$1', [id]
  );
  return rows[0] || null;
}

async function createEnvironment({ name, logo = null, createdBy = null }) {
  const { rows } = await pool.query(
    'INSERT INTO environments (name, logo, created_by) VALUES ($1, $2, $3) RETURNING id, name, logo, created_at, created_by',
    [name, logo, createdBy]
  );
  return rows[0];
}

async function updateEnvironment(id, { name, logo }) {
  const fields = [], params = [];
  let p = 1;
  if (name !== undefined) { fields.push(`name=$${p++}`); params.push(name); }
  if (logo !== undefined) { fields.push(`logo=$${p++}`); params.push(logo); }
  if (!fields.length) return await getEnvironment(id);
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE environments SET ${fields.join(', ')} WHERE id=$${p} RETURNING id, name, logo, created_at, created_by`,
    params
  );
  return rows[0] || null;
}

async function deleteEnvironment(id) {
  if (Number(id) === 1) throw new Error('O ambiente padrão não pode ser removido.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM live_doc          WHERE environment_id=$1', [id]);
    await client.query('DELETE FROM published_flows   WHERE environment_id=$1', [id]);
    await client.query('DELETE FROM backups           WHERE environment_id=$1', [id]);
    await client.query('DELETE FROM access_requests   WHERE environment_id=$1', [id]);
    await client.query('DELETE FROM user_environments WHERE environment_id=$1', [id]);
    await client.query('UPDATE sessions SET current_environment_id=NULL WHERE current_environment_id=$1', [id]);
    await client.query('DELETE FROM environments WHERE id=$1', [id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getEnvironmentsForUser(email, isAdmin) {
  if (isAdmin) return await listEnvironments();
  const { rows } = await pool.query(
    `SELECT e.id, e.name, e.logo, e.created_at, e.created_by
     FROM environments e
     JOIN user_environments ue ON ue.environment_id = e.id
     WHERE ue.email = $1
     ORDER BY e.id`, [email]
  );
  return rows;
}

async function setUserEnvironments(email, environmentIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_environments WHERE email=$1', [email]);
    for (const envId of (environmentIds || [])) {
      await client.query(
        'INSERT INTO user_environments (email, environment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [email, envId]
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

async function userHasEnvironmentAccess(email, isAdmin, envId) {
  if (isAdmin) return true;
  const { rows } = await pool.query(
    'SELECT 1 FROM user_environments WHERE email=$1 AND environment_id=$2', [email, envId]
  );
  return rows.length > 0;
}

// ── Sessões ───────────────────────────────────────────────────────────────────

async function getSessionByToken(token) {
  if (!token) return null;
  try {
    const { rows } = await pool.query(
      'SELECT email, name, is_admin, current_environment_id FROM sessions WHERE token=$1', [token]
    );
    if (!rows.length) return null;
    return {
      email:   rows[0].email,
      name:    rows[0].name,
      isAdmin: rows[0].is_admin,
      currentEnvironmentId: rows[0].current_environment_id || null,
    };
  } catch (e) { return null; }
}

async function setSession(token, { email, name, isAdmin, currentEnvironmentId = null }) {
  await pool.query(
    `INSERT INTO sessions (token, email, name, is_admin, current_environment_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (token) DO UPDATE SET email=$2, name=$3, is_admin=$4, current_environment_id=COALESCE($5, sessions.current_environment_id)`,
    [token, email, name, isAdmin, currentEnvironmentId]
  );
}

async function setSessionEnvironment(token, environmentId) {
  await pool.query(
    'UPDATE sessions SET current_environment_id = $2 WHERE token = $1',
    [token, environmentId]
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

async function loadLiveDoc(envId = 1) {
  try {
    const { rows } = await pool.query('SELECT data FROM live_doc WHERE environment_id=$1', [envId]);
    if (rows.length) return rows[0].data;
    if (envId === 1) {
      const defaultFile = path.join(__dirname, 'default-flow.json');
      if (fs.existsSync(defaultFile)) return JSON.parse(fs.readFileSync(defaultFile, 'utf8'));
    }
    return null;
  } catch (e) { return null; }
}

async function saveLiveDoc(envId, data) {
  if (typeof envId === 'object' && data === undefined) { data = envId; envId = 1; }
  await pool.query(
    `INSERT INTO live_doc (environment_id, data, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (environment_id) DO UPDATE SET data=$2, updated_at=NOW()`,
    [envId, JSON.stringify(data)]
  );
}

// Carrega o doc do ambiente. live_doc e a FONTE DE VERDADE: todo salvamento (sync, restore de
// backup, restore do publicado) escreve nele. Backup so entra como fallback quando o live_doc
// nao existe (ambiente recem-migrado). Antes este metodo devolvia o backup quando ele era mais
// novo que o live_doc — como a tabela de backups era compartilhada entre ambientes (auto.json
// global), isso servia dados antigos/de outro ambiente e "revertia" alteracoes ja salvas.
async function loadLiveDocOrLatestBackup(envId = 1) {
  try {
    const liveRow = await pool.query(
      'SELECT data FROM live_doc WHERE environment_id=$1', [envId]
    );
    if (liveRow.rows.length) return liveRow.rows[0].data;
    const bkpRow = await pool.query(
      'SELECT data FROM backups WHERE environment_id=$1 ORDER BY created_at DESC LIMIT 1', [envId]
    );
    if (bkpRow.rows.length) return bkpRow.rows[0].data;
    if (envId === 1) {
      const defaultFile = path.join(__dirname, 'default-flow.json');
      if (fs.existsSync(defaultFile)) return JSON.parse(fs.readFileSync(defaultFile, 'utf8'));
    }
    return null;
  } catch (e) { return null; }
}

// Auto-backup: cria/atualiza um backup "auto.json" do ambiente com o doc atual.
// Chamado em cada sync para garantir um ponto de recuperacao por ambiente.
// IMPORTANTE: nao retrocede — so atualiza se o doc tem MAIS conteudo (mais nodes/edges/subflows) que o backup atual,
// para nao sobrescrever um backup recente com um sync defasado de outra aba.
async function autoBackup(envId, data) {
  if (!envId || !data) return;
  try {
    const filename = 'auto.json';
    // Carrega o backup atual
    const { rows: cur } = await pool.query(
      'SELECT data FROM backups WHERE filename=$1 AND environment_id=$2', [filename, envId]
    );
    if (cur.length) {
      const curData = cur[0].data;
      const curScore = (curData.nodes?.length || 0) + (curData.edges?.length || 0) + Object.keys(curData.subflows || {}).length;
      const newScore = (data.nodes?.length || 0) + (data.edges?.length || 0) + Object.keys(data.subflows || {}).length;
      // Se o doc novo tem MUITO menos conteudo (mais de 20% de perda), suspeita de sync defasado e NAO sobrescreve
      if (newScore < curScore * 0.8) {
        console.warn(`autoBackup: skip envId=${envId} — newScore=${newScore} curScore=${curScore} (possivel sync defasado)`);
        return;
      }
    }
    await pool.query(
      `INSERT INTO backups (filename, environment_id, data, created_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (filename, environment_id) DO UPDATE SET data=$3, created_at=NOW()`,
      [filename, envId, JSON.stringify(data)]
    );
  } catch (e) { console.error('autoBackup error:', e.message); }
}

// ── Fluxos publicados ─────────────────────────────────────────────────────────

async function loadPublished(slug, envId = null) {
  if (envId) {
    const { rows } = await pool.query(
      'SELECT data, environment_id FROM published_flows WHERE slug=$1 AND environment_id=$2',
      [slug, envId]
    );
    if (!rows.length) return null;
    return { ...rows[0].data, _environmentId: rows[0].environment_id };
  }
  // Sem envId: so devolve algo se houver exatamente UMA publicacao com esse slug
  const { rows } = await pool.query(
    'SELECT data, environment_id FROM published_flows WHERE slug=$1', [slug]
  );
  if (rows.length !== 1) return null;
  return { ...rows[0].data, _environmentId: rows[0].environment_id };
}

async function savePublished(slug, envId, data) {
  if (data === undefined) { data = envId; envId = 1; }
  await pool.query(
    `INSERT INTO published_flows (slug, environment_id, data, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (slug, environment_id) DO UPDATE SET data=$3, updated_at=NOW()`,
    [slug, envId, JSON.stringify(data)]
  );
}

async function publishedExists(slug) {
  const { rows } = await pool.query('SELECT 1 FROM published_flows WHERE slug=$1 LIMIT 1', [slug]);
  return rows.length > 0;
}

// Lista os ambientes que publicaram um determinado slug (com nome e logo)
async function listPublishedEnvsBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT e.id, e.name, e.logo, p.updated_at
     FROM published_flows p
     JOIN environments e ON e.id = p.environment_id
     WHERE p.slug = $1
     ORDER BY p.updated_at DESC`,
    [slug]
  );
  return rows;
}

async function getLastPublishedSlug(envId = null) {
  if (envId) {
    const { rows } = await pool.query(
      'SELECT slug FROM published_flows WHERE environment_id=$1 ORDER BY updated_at DESC LIMIT 1', [envId]
    );
    return rows[0]?.slug || null;
  }
  const { rows } = await pool.query('SELECT slug FROM published_flows ORDER BY updated_at DESC LIMIT 1');
  return rows[0]?.slug || null;
}

async function listPublishedByEnv(envId) {
  const { rows } = await pool.query(
    'SELECT slug, updated_at FROM published_flows WHERE environment_id=$1 ORDER BY updated_at DESC', [envId]
  );
  return rows;
}

// ── Solicitações de acesso ────────────────────────────────────────────────────

async function createAccessRequest(envId, nodeId, nodeTitle, requesterEmail, requesterName) {
  const existing = await pool.query(
    'SELECT id, status FROM access_requests WHERE environment_id=$1 AND node_id=$2 AND requester_email=$3 AND status=$4',
    [envId, nodeId, requesterEmail, 'pending']
  );
  if (existing.rows.length > 0) return { id: existing.rows[0].id, alreadyExists: true };
  const { rows } = await pool.query(
    'INSERT INTO access_requests (environment_id, node_id, node_title, requester_email, requester_name) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [envId, nodeId, nodeTitle, requesterEmail, requesterName]
  );
  return { id: rows[0].id, alreadyExists: false };
}

async function listAccessRequests(envId, status = 'pending') {
  const { rows } = await pool.query(
    'SELECT * FROM access_requests WHERE environment_id=$1 AND status=$2 ORDER BY created_at DESC',
    [envId, status]
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

async function getMyAccessRequests(envId, email) {
  const { rows } = await pool.query(
    'SELECT node_id, status FROM access_requests WHERE environment_id=$1 AND requester_email=$2 ORDER BY created_at DESC',
    [envId, email]
  );
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

async function listBackups(envId = null) {
  const where = envId ? 'WHERE environment_id = $1' : '';
  const params = envId ? [envId] : [];
  const { rows } = await pool.query(
    `SELECT filename, created_at, length(data::text) AS size FROM backups ${where} ORDER BY created_at DESC`,
    params
  );
  return rows.map(r => ({ filename: r.filename, size: parseInt(r.size, 10), mtime: r.created_at }));
}

async function saveBackup(filename, envId, data) {
  if (data === undefined) { data = envId; envId = 1; }
  await pool.query(
    `INSERT INTO backups (filename, environment_id, data, created_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (filename, environment_id) DO UPDATE SET data=$3, created_at=NOW()`,
    [filename, envId, JSON.stringify(data)]
  );
}

async function loadBackup(filename, envId = null) {
  if (envId) {
    const { rows } = await pool.query(
      'SELECT data FROM backups WHERE filename=$1 AND environment_id=$2', [filename, envId]
    );
    return rows.length ? rows[0].data : null;
  }
  const { rows } = await pool.query('SELECT data FROM backups WHERE filename=$1', [filename]);
  return rows.length ? rows[0].data : null;
}

// ── Auditoria ─────────────────────────────────────────────────────────────────

async function logAudit(actorEmail, action, description, target = null, metadata = null, environmentId = null) {
  try {
    await pool.query(
      'INSERT INTO audit_logs (actor_email, action, description, target, metadata, environment_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [actorEmail, action, description, target, metadata ? JSON.stringify(metadata) : null, environmentId]
    );
  } catch (e) { console.error('logAudit error:', e.message); }
}

async function batchLogAudit(actorEmail, entries, environmentId = null) {
  if (!entries || entries.length === 0) return;
  try {
    for (const e of entries) {
      await pool.query(
        'INSERT INTO audit_logs (actor_email, action, description, target, metadata, environment_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [actorEmail, e.action, e.description, e.target || null, e.metadata ? JSON.stringify(e.metadata) : null, environmentId]
      );
    }
  } catch (e) { console.error('batchLogAudit error:', e.message); }
}

async function getAuditLogs({ from, to, user, action, limit = 100, offset = 0, environmentId = null } = {}) {
  try {
    const conds = [], params = [];
    let p = 1;
    if (from)          { conds.push(`created_at >= $${p++}`);     params.push(from); }
    if (to)            { conds.push(`created_at <  $${p++}`);     params.push(to); }
    if (user)          { conds.push(`actor_email ILIKE $${p++}`); params.push(`%${user}%`); }
    if (action)        { conds.push(`action LIKE $${p++}`);       params.push(action + '%'); }
    if (environmentId) { conds.push(`(environment_id = $${p++} OR environment_id IS NULL)`); params.push(environmentId); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const lim = Math.min(Number(limit) || 100, 500);
    const off = Number(offset) || 0;
    const { rows } = await pool.query(
      `SELECT id, actor_email, action, target, description, metadata, environment_id, created_at
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

async function getDbStatus(envId = 1) {
  try {
    const [docRow, backupRow, auditRow, userRow, imgRow] = await Promise.all([
      pool.query(`SELECT updated_at,
                         jsonb_array_length(data->'nodes') AS node_count,
                         jsonb_array_length(data->'edges') AS edge_count,
                         (SELECT count(*) FROM jsonb_object_keys(data->'subflows')) AS subflow_count,
                         pg_size_pretty(length(data::text)::bigint) AS doc_size
                  FROM live_doc WHERE environment_id = $1`, [envId]),
      pool.query(`SELECT COUNT(*) AS total FROM backups WHERE environment_id = $1`, [envId]),
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
  getSessionByToken, setSession, setSessionEnvironment, updateSessionAdmins, revokeDeletedUserSessions,
  loadLiveDoc, saveLiveDoc, loadLiveDocOrLatestBackup, autoBackup,
  loadPublished, savePublished, publishedExists, getLastPublishedSlug, listPublishedByEnv, listPublishedEnvsBySlug,
  listBackups, saveBackup, loadBackup,
  saveImage, loadImage,
  createAccessRequest, listAccessRequests, resolveAccessRequest, getMyAccessRequests,
  logAudit, batchLogAudit, getAuditLogs, clearAuditLogs, deleteAuditLog, getDbStatus,
  listEnvironments, getEnvironment, createEnvironment, updateEnvironment, deleteEnvironment,
  getEnvironmentsForUser, setUserEnvironments, userHasEnvironmentAccess,
};
