const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const axios  = require('axios');
const cloudinary = require('cloudinary').v2;

const PORT = process.env.PORT || 8080;

const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '';
const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || '';
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || '';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'root',
  api_key: process.env.CLOUDINARY_API_KEY || '856997781274259',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'tQzsKOQo3Yb6howiNONMB1u8BCo',
});

const BACKUP_DIR    = path.join(__dirname, 'backup');
const PUBLISHED_DIR = path.join(__dirname, 'published');
const DATA_DIR      = path.join(__dirname, 'data');
const IMAGES_DIR    = path.join(DATA_DIR, 'images');

for (const d of [BACKUP_DIR, PUBLISHED_DIR, DATA_DIR, IMAGES_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const USERS_FILE    = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const LIVE_DOC_FILE = path.join(DATA_DIR, 'live.json');
const DEFAULT_FLOW_FILE = path.join(__dirname, 'default-flow.json');

function loadLiveDoc() {
  try {
    if (fs.existsSync(LIVE_DOC_FILE)) {
      const doc = JSON.parse(fs.readFileSync(LIVE_DOC_FILE, 'utf8'));
      console.log('>>> LIVE DOC CARREGADO: ', doc.nodes?.length, 'nos');
      return doc;
    }
    if (fs.existsSync(DEFAULT_FLOW_FILE)) {
      const doc = JSON.parse(fs.readFileSync(DEFAULT_FLOW_FILE, 'utf8'));
      console.log('>>> DEFAULT FLOW CARREGADO: ', doc.nodes?.length, 'nos');
      return doc;
    }
  } catch(e) { console.log('>>> ERRO loadLiveDoc:', e.message); }
  return null;
}

const DEFAULT_USERS_FILE = path.join(__dirname, 'data', 'users.json');

function loadUsers() {
  try { 
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
    if (fs.existsSync(DEFAULT_USERS_FILE)) {
      const defaultUsers = JSON.parse(fs.readFileSync(DEFAULT_USERS_FILE, 'utf8'));
      fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2), 'utf8');
      return defaultUsers;
    }
    return { admins: [], users: [] };
  }
  catch(e) { return { admins: [], users: [] }; }
}
function saveUsers(data) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch(e) { console.log('>>> ERRO saveUsers:', e.message); }
}

const sessions = new Map();
try {
  const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  for (const [k, v] of Object.entries(raw)) sessions.set(k, v);
} catch(e) {}

function persistSessions() {
  const obj = {};
  for (const [k, v] of sessions) obj[k] = v;
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf8'); } catch(e) {}
}

// SSE: clientes aguardando atualizações de fluxos publicados
const sseClients = new Map();

function notifySseClients(slug) {
  const clients = sseClients.get(slug);
  if (!clients || clients.size === 0) return;
  for (const client of clients) {
    try { client.write(`event: updated\ndata: ${slug}\n\n`); } catch(e) {}
  }
}

// SSE: canal global para o app principal (permissões e doc live)
const sseMainClients = new Set();

function notifyMainClients(event, data) {
  for (const client of sseMainClients) {
    try { client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch(e) {}
  }
}

function parseCookies(req) {
  const result = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) result[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return result;
}

function getSession(req) {
  const token = parseCookies(req).fc_session;
  return token ? (sessions.get(token) || null) : null;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}

const mimeTypes = {
  '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/babel',
  '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const RESERVED = new Set(['api', 'components', 'pages', 'backup', 'published', 'data', 'login']);

// Lê o UPN (email) do usuário Windows logado na máquina
function getWindowsUPN() {
  return new Promise((resolve, reject) => {
    exec('whoami /upn', { timeout: 5000 }, (err, stdout) => {
      if (err) { reject(err); return; }
      const upn = stdout.trim().toLowerCase();
      if (!upn || !upn.includes('@')) { reject(new Error('UPN inválido')); return; }
      resolve(upn);
    });
  });
}

function serveHtml(res, userInfo, newToken, simulateAs) {
  try {
    let html = fs.readFileSync('./pages/Fluxograma Interativo.html', 'utf8');
    const liveDoc = loadLiveDoc();
    let script = `window.__CURRENT_USER__=${JSON.stringify(userInfo)};`;
    if (simulateAs) script += `window.__SIMULATE_AS__=${JSON.stringify(simulateAs)};`;
    if (liveDoc && liveDoc.nodes && liveDoc.edges) {
      script += `window.__LIVE_DOC__=${JSON.stringify(liveDoc)};`;
    }
    html = html.replace('</head>', `<script>${script}</script>\n</head>`);
    const headers = { 'Content-Type': 'text/html' };
    if (newToken) headers['Set-Cookie'] = `fc_session=${newToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
    res.writeHead(200, headers);
    res.end(html, 'utf-8');
  } catch(e) { res.writeHead(500); res.end('Erro ao servir aplicação'); }
}

async function serveMainApp(req, res) {
  const parsedUrl = new URL(req.url, 'http://localhost');
  const simulateAs = parsedUrl.searchParams.get('simulate_as');

  // Simulação: admin abre a visão de outro usuário em nova aba
  const session = getSession(req);
  if (simulateAs && session && session.isAdmin) {
    const email = simulateAs.trim().toLowerCase();
    const users = loadUsers();
    const simUser = users.users.find(u => u.email === email);
    if (!simUser) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<p>Usuário <b>${email}</b> não encontrado.</p>`);
      return;
    }
    const isAdmin = users.admins.includes(email);
    serveHtml(res, { email, isAdmin, name: simUser.name }, null, email);
    return;
  }

  // Se já tem sessão válida, servir direto
  if (session) { serveHtml(res, session, null); return; }

  // Detectar usuário Windows automaticamente via whoami /upn
  let email;
  try {
    email = await getWindowsUPN();
  } catch(e) {
    // Máquina fora do domínio ou whoami falhou → tela de login manual
    res.writeHead(302, { Location: '/login' }); res.end(); return;
  }

  const users = loadUsers();

  // Bootstrap: primeiro acesso vira admin automaticamente
  if (users.admins.length === 0 && users.users.length === 0) {
    users.admins.push(email);
    users.users.push({ email, name: email.split('@')[0] });
    saveUsers(users);
  } else if (!users.admins.includes(email) && !users.users.some(u => u.email === email)) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Acesso negado</title>
<style>body{font-family:-apple-system,sans-serif;max-width:480px;margin:100px auto;padding:24px;text-align:center}
h2{color:#a52828}.em{font:13px monospace;background:#f5f5f5;padding:3px 8px;border-radius:4px}
p{color:#555;line-height:1.6}</style></head><body>
<h2>Acesso não autorizado</h2>
<p>Seu usuário <span class="em">${email}</span> não está cadastrado no sistema.</p>
<p>Solicite acesso ao administrador.</p></body></html>`);
    return;
  }

  const isAdmin = users.admins.includes(email);
  const userRecord = users.users.find(u => u.email === email) || { name: email.split('@')[0] };
  const token = crypto.randomBytes(24).toString('hex');
  const userInfo = { email, isAdmin, name: userRecord.name };
  sessions.set(token, userInfo);
  persistSessions();
  serveHtml(res, userInfo, token);
}

const server = http.createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(); return;
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  if (req.url === '/login' && req.method === 'GET') {
    if (getSession(req)) { res.writeHead(302, { Location: '/' }); res.end(); return; }
    try {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync('./pages/login.html', 'utf8'), 'utf-8');
    } catch(e) { res.writeHead(500); res.end('Login page not found'); }
    return;
  }

  if (req.url === '/api/auth/login' && req.method === 'POST') {
    try {
      const { email: rawEmail = '' } = await readBody(req);
      const email = rawEmail.trim().toLowerCase();
      if (!email || !email.includes('@')) { sendJson(res, 400, { ok: false, error: 'E-mail inválido' }); return; }

      const users = loadUsers();
      // Bootstrap: primeiro acesso vira admin
      if (users.admins.length === 0 && users.users.length === 0) {
        users.admins.push(email);
        users.users.push({ email, name: email.split('@')[0] });
        saveUsers(users);
      } else if (!users.admins.includes(email) && !users.users.some(u => u.email === email)) {
        sendJson(res, 403, { ok: false, error: 'E-mail não autorizado. Solicite acesso ao administrador.' }); return;
      }

      const isAdmin = users.admins.includes(email);
      const userRecord = users.users.find(u => u.email === email) || { email, name: email.split('@')[0] };
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { email, isAdmin, name: userRecord.name });
      persistSessions();

      res.writeHead(200, {
        'Content-Type': 'application/json',
        // Sessão de 1 ano — o usuário não precisa fazer login de novo
        'Set-Cookie': `fc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
      });
      res.end(JSON.stringify({ ok: true }));
    } catch(e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // ── Microsoft OAuth ───────────────────────────────────────────────────

  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = new URL(req.url, `${protocol}://${host}`);
  const pathname = baseUrl.pathname;

  if (pathname === '/auth/microsoft' && req.method === 'GET') {
    const redirectUri = `${protocol}://${host}/auth/callback`;
    const scope = 'openid email profile User.Read';
    const state = crypto.randomBytes(8).toString('hex');
    const authUrl = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/authorize?` +
      `client_id=${AZURE_CLIENT_ID}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${state}`;
    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  if (pathname === '/auth/callback' && req.method === 'GET') {
    const code = baseUrl.searchParams.get('code');
    const redirectUri = `${protocol}://${host}/auth/callback`;

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>Erro</h1><p>Código não recebido.</p><a href="/login">Voltar</a>');
      return;
    }

    try {
      const tokenResponse = await axios.post(
        `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`,
        new URLSearchParams({
          client_id: AZURE_CLIENT_ID,
          client_secret: AZURE_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const accessToken = tokenResponse.data.access_token;

      const userResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const email = (userResponse.data.mail || userResponse.data.userPrincipalName || '').toLowerCase();

      if (!email || !email.includes('@')) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Erro</h1><p>Email não encontrado.</p><a href="/login">Voltar</a>');
        return;
      }

      const users = loadUsers();
      const userRecord = users.users.find(u => u.email === email);

      // Primeiro acesso: permitir automatico (cria usuario e admin)
      if (!userRecord && users.admins.length === 0 && users.users.length === 0) {
        users.admins.push(email);
        users.users.push({ email, name: userResponse.data.displayName || email.split('@')[0] });
        saveUsers(users);
      }
      // Ja tem usuarios: verificar se esta cadastrado
      else if (!userRecord && !users.users.some(u => u.email === email)) {
        res.writeHead(403, { 'Content-Type': 'text/html' });
        res.end('<h1>Acesso Negado</h1><p>Seu email não está cadastrado no sistema.<br>Solicite acesso ao administrador.</p><a href="/login">Voltar</a>');
        return;
      }
      // Se ja tem usuarios e ele nao esta cadastrado, deny
      else if (!users.admins.includes(email) && !users.users.some(u => u.email === email)) {
        res.writeHead(403, { 'Content-Type': 'text/html' });
        res.end('<h1>Acesso Negado</h1><p>Seu email não está cadastrado no sistema.<br>Solicite acesso ao administrador.</p><a href="/login">Voltar</a>');
        return;
      }

      const isAdmin = users.admins.includes(email);
      const name = userRecord?.name || userResponse.data.displayName || email.split('@')[0];
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { email, isAdmin, name });
      persistSessions();

      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': `fc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
      });
      res.end();
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h1>Erro na autenticação</h1><p>${e.message}</p><a href="/login">Voltar</a>`);
    }
    return;
  }

  // ── User management (admin only) ─────────────────────────────────────────

  if (req.url === '/api/users' && req.method === 'GET') {
    const session = getSession(req);
    if (!session || !session.isAdmin) { sendJson(res, 403, { ok: false, error: 'Acesso restrito' }); return; }
    sendJson(res, 200, { ok: true, data: loadUsers() }); return;
  }

  if (req.url === '/api/users/save' && req.method === 'POST') {
    const session = getSession(req);
    if (!session || !session.isAdmin) { sendJson(res, 403, { ok: false, error: 'Acesso restrito' }); return; }
    try {
      const body = await readBody(req);
      if (!Array.isArray(body.admins) || !Array.isArray(body.users)) {
        sendJson(res, 400, { ok: false, error: 'Formato inválido' }); return;
      }
      saveUsers({ admins: body.admins, users: body.users });
      for (const [token, info] of sessions) {
        sessions.set(token, { ...info, isAdmin: body.admins.includes(info.email) });
      }
      persistSessions();
      notifyMainClients('users_updated', { admins: body.admins });
      sendJson(res, 200, { ok: true });
    } catch(e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // ── Sync de doc live (permissões de nós em tempo real) ───────────────────

  if (req.url === '/api/doc/sync' && req.method === 'POST') {
    const session = getSession(req);
    if (!session || !session.isAdmin) { sendJson(res, 403, { ok: false, error: 'Acesso restrito' }); return; }
    try {
      const body = await readBody(req);
      fs.writeFileSync(LIVE_DOC_FILE, JSON.stringify(body, null, 2), 'utf8');
      notifyMainClients('doc_updated', {});
      sendJson(res, 200, { ok: true });
    } catch(e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (req.url === '/api/doc/live' && req.method === 'GET') {
    const session = getSession(req);
    if (!session) { sendJson(res, 401, { ok: false }); return; }
    try {
      if (!fs.existsSync(LIVE_DOC_FILE)) { sendJson(res, 404, { ok: false }); return; }
      sendJson(res, 200, { ok: true, data: JSON.parse(fs.readFileSync(LIVE_DOC_FILE, 'utf8')) });
    } catch(e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // ── Imagens ──────────────────────────────────────────────────────────────

  if (req.url === '/api/images/upload' && req.method === 'POST') {
    if (!getSession(req)) { sendJson(res, 401, { ok: false }); return; }
    try {
      const { filename = 'image', data } = await readBody(req);
      const m = (data || '').match(/^data:([^;]+);base64,(.+)$/s);
      if (!m) { sendJson(res, 400, { ok: false, error: 'Dados inválidos' }); return; }
      const ext = filename.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const buffer = Buffer.from(m[2], 'base64');
      if (process.env.CLOUDINARY_API_SECRET) {
        const uploadResult = await cloudinary.uploader.upload(`data:${m[1]};base64,${m[2]}`, { folder: 'fluxograma' });
        sendJson(res, 200, { ok: true, url: uploadResult.secure_url });
      } else {
        const safe = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
        fs.writeFileSync(path.join(IMAGES_DIR, safe), buffer);
        sendJson(res, 200, { ok: true, url: `/api/images/${safe}` });
      }
    } catch(e) { 
      console.log('>>> ERRO UPLOAD:', e.message);
      sendJson(res, 500, { ok: false, error: e.message }); 
    }
    return;
  }

  const imgServeMatch = req.url.match(/^\/api\/images\/([a-zA-Z0-9_\-.]+)$/);
  if (imgServeMatch && req.method === 'GET') {
    const filepath = path.join(IMAGES_DIR, imgServeMatch[1]);
    if (!fs.existsSync(filepath)) { res.writeHead(404); res.end(); return; }
    const ext = imgServeMatch[1].split('.').pop().toLowerCase();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
                   gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'max-age=31536000' });
    res.end(fs.readFileSync(filepath));
    return;
  }

  // ── Backup ───────────────────────────────────────────────────────────────

  if (req.url === '/api/backup/save' && req.method === 'POST') {
    if (!getSession(req)) { sendJson(res, 401, { ok: false, error: 'Não autenticado' }); return; }
    try {
      const body = await readBody(req);
      let filename;
      if (body.overwriteFile) {
        filename = body.overwriteFile.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        if (!filename.endsWith('.json')) filename += '.json';
      } else {
        const name = (body.name || 'backup').replace(/[^a-zA-Z0-9_\-]/g, '_');
        filename = `${new Date().toISOString().replace(/[:.]/g, '-')}_${name}.json`;
      }
      fs.writeFileSync(path.join(BACKUP_DIR, filename), JSON.stringify(body.data, null, 2), 'utf8');
      sendJson(res, 200, { ok: true, filename });
    } catch(e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (req.url === '/api/backup/list' && req.method === 'GET') {
    if (!getSession(req)) { sendJson(res, 401, { ok: false, error: 'Não autenticado' }); return; }
    try {
      const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json'))
        .sort().reverse()
        .map(f => {
          const stat = fs.statSync(path.join(BACKUP_DIR, f));
          return { filename: f, size: stat.size, mtime: stat.mtime };
        });
      sendJson(res, 200, { ok: true, files });
    } catch(e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // ── Publish ──────────────────────────────────────────────────────────────

  if (req.url === '/api/publish/save' && req.method === 'POST') {
    if (!getSession(req)) { sendJson(res, 401, { ok: false, error: 'Não autenticado' }); return; }
    try {
      const body = await readBody(req);
      const slug = (body.slug || '').replace(/[^a-z0-9\-]/g, '').slice(0, 60);
      if (!slug) { sendJson(res, 400, { ok: false, error: 'Slug inválido' }); return; }
      fs.writeFileSync(path.join(PUBLISHED_DIR, `${slug}.json`), JSON.stringify(body.data, null, 2), 'utf8');
      notifySseClients(slug);
      sendJson(res, 200, { ok: true, slug });
    } catch(e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  const publishMatch = req.url.match(/^\/api\/publish\/load\/([a-z0-9][a-z0-9\-]{0,59})$/);
  if (publishMatch && req.method === 'GET') {
    try {
      const filepath = path.join(PUBLISHED_DIR, `${publishMatch[1]}.json`);
      if (!fs.existsSync(filepath)) { sendJson(res, 404, { ok: false, error: 'Fluxo não encontrado' }); return; }
      sendJson(res, 200, { ok: true, data: JSON.parse(fs.readFileSync(filepath, 'utf8')) });
    } catch(e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  const loadMatch = req.url.match(/^\/api\/backup\/load\?file=(.+)$/);
  if (loadMatch && req.method === 'GET') {
    if (!getSession(req)) { sendJson(res, 401, { ok: false, error: 'Não autenticado' }); return; }
    try {
      const filename = decodeURIComponent(loadMatch[1]).replace(/[/\\]/g, '');
      const filepath = path.join(BACKUP_DIR, filename);
      if (!fs.existsSync(filepath)) { sendJson(res, 404, { ok: false, error: 'Arquivo não encontrado' }); return; }
      sendJson(res, 200, { ok: true, data: JSON.parse(fs.readFileSync(filepath, 'utf8')) });
    } catch(e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // ── SSE: canal global (permissões e doc live) ────────────────────────────

  if (req.url === '/api/events/__main__' && req.method === 'GET') {
    const session = getSession(req);
    if (!session) { res.writeHead(401); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(':\n\n');
    sseMainClients.add(res);
    const hbMain = setInterval(() => {
      try { res.write(':\n\n'); } catch(e) { clearInterval(hbMain); }
    }, 25000);
    req.on('close', () => { clearInterval(hbMain); sseMainClients.delete(res); });
    return;
  }

  // ── SSE: atualizações de fluxos publicados ───────────────────────────────

  const eventsMatch = req.url.match(/^\/api\/events\/([a-z0-9][a-z0-9\-]{0,59})$/);
  if (eventsMatch && req.method === 'GET') {
    const slug = eventsMatch[1];
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(':\n\n');
    if (!sseClients.has(slug)) sseClients.set(slug, new Set());
    sseClients.get(slug).add(res);
    const hb = setInterval(() => {
      try { res.write(':\n\n'); } catch(e) { clearInterval(hb); }
    }, 25000);
    req.on('close', () => { clearInterval(hb); sseClients.get(slug)?.delete(res); });
    return;
  }

  // ── Published slug route (sem auth) ─────────────────────────────────────

  const slugRouteMatch = req.url.match(/^\/([a-z0-9][a-z0-9\-]{0,58}[a-z0-9]?)$/);
  if (slugRouteMatch && req.method === 'GET' && !RESERVED.has(slugRouteMatch[1])) {
    const slug = slugRouteMatch[1];
    const publishedFile = path.join(PUBLISHED_DIR, `${slug}.json`);
    if (fs.existsSync(publishedFile)) {
      try {
        let html = fs.readFileSync('./pages/Fluxograma Interativo.html', 'utf8');
        html = html.replace('</head>', `<script>window.__PUBLISHED_SLUG__="${slug}";</script>\n</head>`);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html, 'utf-8');
      } catch(e) { res.writeHead(500); res.end('Erro ao servir fluxo publicado'); }
      return;
    }
  }

  // ── Main app ─────────────────────────────────────────────────────────────

  if (req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/') {
    await serveMainApp(req, res); return;
  }

  if (req.method === 'GET' && req.url.includes('Fluxograma') && req.url.endsWith('.html')) {
    await serveMainApp(req, res); return;
  }

  // ── Static file fallback ─────────────────────────────────────────────────

  const filePath = '.' + req.url;
  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 - Arquivo não encontrado</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end('Erro no servidor: ' + error.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n✓ Servidor rodando em http://localhost:${PORT}\n`);
});
