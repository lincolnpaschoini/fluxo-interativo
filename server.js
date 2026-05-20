const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const { exec } = require('child_process');
const axios    = require('axios');
const db       = require('./db');

const PORT = process.env.PORT || 8080;

const AZURE_CLIENT_ID     = process.env.AZURE_CLIENT_ID     || '';
const AZURE_TENANT_ID     = process.env.AZURE_TENANT_ID     || '';
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || '';

// Cache local de imagens (apenas para acelerar serve; fonte de verdade é o banco)
const IMAGES_DIR = path.join(__dirname, 'data', 'images');
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

const mimeTypes = {
  '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/babel',
  '.css': 'text/css',   '.json': 'application/json',
  '.png': 'image/png',  '.jpg': 'image/jpg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const RESERVED = new Set(['api', 'components', 'pages', 'backup', 'published', 'data', 'login']);

// Merge três-vias: combina alterações do cliente com o estado atual do banco,
// preservando mudanças de outros usuários que o cliente não viu.
function mergeDoc(base, client, server) {
  // Nós: merge por ID
  const baseMap   = Object.fromEntries((base.nodes   || []).map(n => [n.id, n]));
  const clientMap = Object.fromEntries((client.nodes || []).map(n => [n.id, n]));
  const serverMap = Object.fromEntries((server.nodes || []).map(n => [n.id, n]));
  const allIds = new Set([...Object.keys(baseMap), ...Object.keys(clientMap), ...Object.keys(serverMap)]);
  const mergedNodes = [];
  for (const id of allIds) {
    const b = baseMap[id], c = clientMap[id], s = serverMap[id];
    if (!b) {
      if (c) mergedNodes.push(c);       // cliente adicionou
      else if (s) mergedNodes.push(s);  // servidor adicionou (cliente não viu)
    } else {
      if (!c) continue;                  // cliente deletou → respeita deleção
      if (!s) { mergedNodes.push(c); continue; } // servidor deletou mas cliente editou → mantém cliente
      const cChanged = JSON.stringify(c) !== JSON.stringify(b);
      const sChanged = JSON.stringify(s) !== JSON.stringify(b);
      // Só cliente mudou → usa cliente; só servidor mudou → usa servidor; ambos → cliente vence
      mergedNodes.push(!cChanged && sChanged ? s : c);
    }
  }

  // Arestas: mantém as do cliente + adiciona as do servidor que o cliente nunca viu
  const edgeFp = e => `${e.from}|${e.to}|${e.fromSide||'r'}|${e.toSide||'l'}`;
  const baseEdgeFps   = new Set((base.edges   || []).map(edgeFp));
  const clientEdgeFps = new Set((client.edges || []).map(edgeFp));
  const mergedEdges   = [...(client.edges || [])];
  for (const edge of (server.edges || [])) {
    if (!baseEdgeFps.has(edgeFp(edge)) && !clientEdgeFps.has(edgeFp(edge)))
      mergedEdges.push(edge);
  }

  // Subflows: merge three-way explícito por chave (nodeId)
  const baseSf   = base.subflows   || {};
  const clientSf = client.subflows || {};
  const serverSf = server.subflows || {};
  const mergedSubflows = {};
  const allSfKeys = new Set([...Object.keys(baseSf), ...Object.keys(clientSf), ...Object.keys(serverSf)]);
  for (const key of allSfKeys) {
    const inBase   = key in baseSf;
    const inClient = key in clientSf;
    const inServer = key in serverSf;
    if (!inBase && inServer && !inClient) {
      mergedSubflows[key] = serverSf[key]; // servidor adicionou após client sincronizar → sempre preserva
    } else if (!inBase && inClient) {
      mergedSubflows[key] = clientSf[key]; // cliente adicionou → usa versão do cliente
    } else if (inBase && !inClient) {
      // cliente deletou explicitamente → não adiciona (respeita deleção)
    } else if (inClient) {
      mergedSubflows[key] = clientSf[key]; // cliente tem versão → cliente vence
    } else if (inServer) {
      mergedSubflows[key] = serverSf[key]; // só sobrou no servidor → preserva
    }
  }

  const { _baseNodes, _baseEdges, _baseSubflows, ...clientClean } = client;
  return { ...server, ...clientClean, nodes: mergedNodes, edges: mergedEdges, subflows: mergedSubflows };
}

// Detecta diferenças entre dois estados do documento e retorna entradas de auditoria
const NODE_FIELD_LABELS = { label: 'Título', color: 'Cor', shape: 'Formato', w: 'Largura', h: 'Altura', allowedUsers: 'Permissões' };
const NODE_SKIP_FIELDS  = new Set(['x', 'y', 'id']);

// Normaliza um step para comparação: garante campos ausentes = valores padrão,
// evitando falsos "campos internos alterados" por diferença de {subSteps:[]} vs {}
function normalizeStep(s) {
  return {
    title:     s.title     || '',
    desc:      s.desc      || '',
    owner:     s.owner     || '',
    duration:  s.duration  || '',
    color:     s.color     || '',
    hasSubflow: !!s.hasSubflow,
    subSteps:  s.subSteps  || [],
    images:    s.images    || [],
    links:     s.links     || [],
  };
}

function diffDocs(before, after) {
  const entries = [];
  const bNodes = Object.fromEntries((before.nodes || []).map(n => [n.id, n]));
  const aNodes = Object.fromEntries((after.nodes  || []).map(n => [n.id, n]));
  for (const id of new Set([...Object.keys(bNodes), ...Object.keys(aNodes)])) {
    const b = bNodes[id], a = aNodes[id];
    const label = `"${((a || b).label || id).replace(/\n/g, ' ').slice(0, 60)}"`;
    if (!b && a) {
      entries.push({ action: 'node_add', target: id, description: `Nó adicionado: ${label}`,
        metadata: { label: a.label, color: a.color } });
    } else if (b && !a) {
      entries.push({ action: 'node_delete', target: id, description: `Nó removido: ${label}`,
        metadata: { label: b.label, color: b.color } });
    } else if (b && a && JSON.stringify(b) !== JSON.stringify(a)) {
      const changes = [];
      for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
        if (NODE_SKIP_FIELDS.has(key)) continue;
        if (JSON.stringify(b[key]) !== JSON.stringify(a[key]))
          changes.push({ field: key, label: NODE_FIELD_LABELS[key] || key, before: b[key], after: a[key] });
      }
      entries.push({ action: 'node_edit', target: id, description: `Nó editado: ${label}`,
        metadata: { changes } });
    }
  }
  const edgeFp  = e => `${e.from}|${e.to}|${e.fromSide||'r'}|${e.toSide||'l'}`;
  const bEdgeFps = new Set((before.edges || []).map(edgeFp));
  const aEdgeFps = new Set((after.edges  || []).map(edgeFp));
  for (const fp of aEdgeFps) {
    if (!bEdgeFps.has(fp)) {
      const [from, to] = fp.split('|');
      const fL = (aNodes[from] || bNodes[from] || {}).label || from;
      const tL = (aNodes[to]   || bNodes[to]   || {}).label || to;
      entries.push({ action: 'edge_add', target: fp, description: `Seta adicionada: "${fL}" → "${tL}"` });
    }
  }
  for (const fp of bEdgeFps) {
    if (!aEdgeFps.has(fp)) {
      const [from, to] = fp.split('|');
      const fL = (bNodes[from] || {}).label || from;
      const tL = (bNodes[to]   || {}).label || to;
      entries.push({ action: 'edge_delete', target: fp, description: `Seta removida: "${fL}" → "${tL}"` });
    }
  }
  const bSf = before.subflows || {}, aSf = after.subflows || {};
  for (const key of new Set([...Object.keys(bSf), ...Object.keys(aSf)])) {
    const nodeLabel = ((aNodes[key] || bNodes[key] || {}).label || key).slice(0, 60);
    if (!bSf[key] && aSf[key]) {
      entries.push({ action: 'subflow_add', target: key, description: `Sub-fluxo criado: "${nodeLabel}"`,
        metadata: { stepCount: (aSf[key]?.steps || []).length } });
    } else if (bSf[key] && !aSf[key]) {
      entries.push({ action: 'subflow_delete', target: key, description: `Sub-fluxo removido: "${nodeLabel}"`,
        metadata: { stepCount: (bSf[key]?.steps || []).length } });
    } else if (bSf[key] && aSf[key] && JSON.stringify(bSf[key]) !== JSON.stringify(aSf[key])) {
      const bSteps = bSf[key]?.steps || [];
      const aSteps = aSf[key]?.steps || [];
      // Debug: loga chaves fora de 'steps' que diferem
      const bOther = Object.fromEntries(Object.entries(bSf[key]).filter(([k]) => k !== 'steps'));
      const aOther = Object.fromEntries(Object.entries(aSf[key]).filter(([k]) => k !== 'steps'));
      if (JSON.stringify(bOther) !== JSON.stringify(aOther)) console.log(`[audit-debug] subflow ${key} difere fora de steps: b=${JSON.stringify(bOther)} a=${JSON.stringify(aOther)}`);
      const bMap = Object.fromEntries(bSteps.map((s, i) => [s.id || `_${i}`, s]));
      const aMap = Object.fromEntries(aSteps.map((s, i) => [s.id || `_${i}`, s]));
      const added = [], removed = [], edited = [];
      for (const k of new Set([...Object.keys(bMap), ...Object.keys(aMap)])) {
        const bs = bMap[k], as_ = aMap[k];
        if (!bs && as_) {
          const safeUrl = (u) => (u && u.length < 800 && !u.startsWith('data:')) ? u : null;
          const detail = { title: as_.title || 'Nova etapa' };
          if (as_.desc)                    detail.desc = stripHtml(as_.desc).slice(0, 200) || true;
          if ((as_.owner || ''))           detail.owner = as_.owner || '';
          if ((as_.duration || ''))        detail.duration = as_.duration || '';
          if ((as_.images || []).length)   detail.images = (as_.images || []).map(i => ({ url: safeUrl(i.url), caption: i.caption || '' }));
          if ((as_.links  || []).length)   detail.links  = (as_.links  || []).map(l => ({ label: l.label, url: l.url }));
          added.push(detail);
        } else if (bs && !as_) {
          const safeUrl = (u) => (u && u.length < 800 && !u.startsWith('data:')) ? u : null;
          const detail = { title: bs.title || 'Etapa' };
          if ((bs.images || []).length) detail.images = (bs.images || []).map(i => ({ url: safeUrl(i.url), caption: i.caption || '' }));
          if ((bs.links  || []).length) detail.links  = (bs.links  || []).map(l => ({ label: l.label, url: l.url }));
          removed.push(detail);
        } else if (bs && as_ && JSON.stringify(normalizeStep(bs)) !== JSON.stringify(normalizeStep(as_))) {
          const stepChanges = [];
          const stripHtml = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (bs.title !== as_.title)
            stepChanges.push({ type: 'title', before: bs.title || '', after: as_.title || '' });
          if (bs.desc !== as_.desc) {
            const preview = stripHtml(as_.desc).slice(0, 200);
            stepChanges.push({ type: 'desc', after: preview || null });
          }
          if ((bs.owner || '') !== (as_.owner || ''))
            stepChanges.push({ type: 'owner', before: bs.owner || '', after: as_.owner || '' });
          if ((bs.duration || '') !== (as_.duration || ''))
            stepChanges.push({ type: 'duration', before: bs.duration || '', after: as_.duration || '' });
          if (bs.color !== as_.color)
            stepChanges.push({ type: 'color', before: bs.color, after: as_.color });
          if ((bs.hasSubflow || false) !== (as_.hasSubflow || false))
            stepChanges.push({ type: 'hasSubflow', after: as_.hasSubflow || false });

          // Images: diff by id
          const bImgMap = Object.fromEntries((bs.images || []).map(i => [i.id, i]));
          const aImgMap = Object.fromEntries((as_.images || []).map(i => [i.id, i]));
          const addedImgs   = (as_.images || []).filter(i => !bImgMap[i.id]);
          const removedImgs = (bs.images || []).filter(i => !aImgMap[i.id]);
          // Store URL only if it's a server path (not a huge base64 blob)
          const safeUrl = (u) => (u && u.length < 800 && !u.startsWith('data:')) ? u : null;
          if (addedImgs.length)   stepChanges.push({ type: 'images_added',   images: addedImgs.map(i   => ({ url: safeUrl(i.url),   caption: i.caption || '' })) });
          if (removedImgs.length) stepChanges.push({ type: 'images_removed', images: removedImgs.map(i => ({ url: safeUrl(i.url),   caption: i.caption || '' })) });

          // Links: diff by id
          const bLinkMap = Object.fromEntries((bs.links || []).map(l => [l.id, l]));
          const aLinkMap = Object.fromEntries((as_.links || []).map(l => [l.id, l]));
          const addedLinks   = (as_.links || []).filter(l => !bLinkMap[l.id]);
          const removedLinks = (bs.links || []).filter(l => !aLinkMap[l.id]);
          const changedLinks = (as_.links || []).filter(l => bLinkMap[l.id] && JSON.stringify(bLinkMap[l.id]) !== JSON.stringify(l));
          if (addedLinks.length)   stepChanges.push({ type: 'links_added',   links: addedLinks.map(l   => ({ label: l.label, url: l.url })) });
          if (removedLinks.length) stepChanges.push({ type: 'links_removed', links: removedLinks.map(l => ({ label: l.label, url: l.url })) });
          if (changedLinks.length) stepChanges.push({ type: 'links_changed', links: changedLinks.map(l => ({ label: l.label, url: l.url })) });

          // Sub-etapas (3° nível): diff detalhado
          const bSubs = bs.subSteps || [], aSubs = as_.subSteps || [];
          if (JSON.stringify(bSubs) !== JSON.stringify(aSubs)) {
            const bSubMap = Object.fromEntries(bSubs.map((s, i) => [s.id || `_${i}`, s]));
            const aSubMap = Object.fromEntries(aSubs.map((s, i) => [s.id || `_${i}`, s]));
            const addedSubs = [], removedSubs = [], editedSubs = [];
            for (const k of new Set([...Object.keys(bSubMap), ...Object.keys(aSubMap)])) {
              const bss = bSubMap[k], ass = aSubMap[k];
              if (!bss && ass) {
                addedSubs.push({ title: ass.title || 'Nova sub-etapa', desc: ass.desc ? stripHtml(ass.desc).slice(0, 150) : null });
              } else if (bss && !ass) {
                removedSubs.push({ title: bss.title || 'Sub-etapa' });
              } else if (bss && ass && JSON.stringify({ title: bss.title||'', desc: bss.desc||'', owner: bss.owner||'', duration: bss.duration||'', images: bss.images||[], links: bss.links||[] }) !== JSON.stringify({ title: ass.title||'', desc: ass.desc||'', owner: ass.owner||'', duration: ass.duration||'', images: ass.images||[], links: ass.links||[] })) {
                const sc = [];
                if (bss.title !== ass.title) sc.push({ type: 'title', before: bss.title || '', after: ass.title || '' });
                if (bss.desc !== ass.desc) { const p = stripHtml(ass.desc).slice(0, 150); sc.push({ type: 'desc', after: p || null }); }
                if ((bss.owner || '') !== (ass.owner || '')) sc.push({ type: 'owner', before: bss.owner || '', after: ass.owner || '' });
                if ((bss.duration || '') !== (ass.duration || '')) sc.push({ type: 'duration', before: bss.duration || '', after: ass.duration || '' });
                const bImgMapSub = Object.fromEntries((bss.images || []).map(i => [i.id, i]));
                const aImgMapSub = Object.fromEntries((ass.images || []).map(i => [i.id, i]));
                const addedImgsSub   = (ass.images || []).filter(i => !bImgMapSub[i.id]);
                const removedImgsSub = (bss.images || []).filter(i => !aImgMapSub[i.id]);
                if (addedImgsSub.length)   sc.push({ type: 'images_added',   images: addedImgsSub.map(i   => ({ url: safeUrl(i.url), caption: i.caption || '' })) });
                if (removedImgsSub.length) sc.push({ type: 'images_removed', images: removedImgsSub.map(i => ({ url: safeUrl(i.url), caption: i.caption || '' })) });
                const bLinkMapSub = Object.fromEntries((bss.links || []).map(l => [l.id, l]));
                const aLinkMapSub = Object.fromEntries((ass.links || []).map(l => [l.id, l]));
                const addedLinksSub   = (ass.links || []).filter(l => !bLinkMapSub[l.id]);
                const removedLinksSub = (bss.links || []).filter(l => !aLinkMapSub[l.id]);
                const changedLinksSub = (ass.links || []).filter(l => bLinkMapSub[l.id] && JSON.stringify(bLinkMapSub[l.id]) !== JSON.stringify(l));
                if (addedLinksSub.length)   sc.push({ type: 'links_added',   links: addedLinksSub.map(l   => ({ label: l.label, url: l.url })) });
                if (removedLinksSub.length) sc.push({ type: 'links_removed', links: removedLinksSub.map(l => ({ label: l.label, url: l.url })) });
                if (changedLinksSub.length) sc.push({ type: 'links_changed', links: changedLinksSub.map(l => ({ label: l.label, url: l.url })) });
                editedSubs.push({ title: bss.title || 'Sub-etapa', changes: sc });
              }
            }
            stepChanges.push({ type: 'substeps', added: addedSubs, removed: removedSubs, edited: editedSubs });
          }

          if (stepChanges.length === 0) {
            console.log('[audit-debug] stepChanges vazio para etapa:', bs.title, '| bs:', JSON.stringify(normalizeStep(bs)), '| as_:', JSON.stringify(normalizeStep(as_)));
          }
          edited.push({ title: bs.title || 'Etapa', changes: stepChanges });
        }
      }
      entries.push({ action: 'subflow_edit', target: key, description: `Sub-fluxo editado: "${nodeLabel}"`,
        metadata: { added, removed, edited } });
    }
  }
  return entries;
}

// SSE: clientes aguardando atualizações de fluxos publicados
const sseClients = new Map();

function notifySseClients(slug) {
  const clients = sseClients.get(slug);
  if (!clients || clients.size === 0) return;
  for (const client of clients) {
    try { client.write(`event: updated\ndata: ${slug}\n\n`); } catch (e) {}
  }
}

// SSE: canal global para o app principal (permissões e doc live)
const sseMainClients = new Set();

function notifyMainClients(event, data) {
  for (const client of sseMainClients) {
    try { client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) {}
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

async function getSession(req) {
  const token = parseCookies(req).fc_session;
  const session = await db.getSessionByToken(token || null);
  console.log('>>> getSession: token=', token ? 'sim' : 'nao', '| session=', session ? 'sim' : 'nao');
  return session;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

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

function serveHtml(res, userInfo, newToken, simulateAs = null, liveDoc = null) {
  try {
    let html = fs.readFileSync('./pages/Fluxograma Interativo.html', 'utf8');
    let script = `window.__CURRENT_USER__=${JSON.stringify(userInfo)};`;
    if (simulateAs) script += `window.__SIMULATE_AS__=${JSON.stringify(simulateAs)};`;
    if (liveDoc && liveDoc.nodes && liveDoc.edges) {
      script += `window.__LIVE_DOC__=${JSON.stringify(liveDoc)};`;
    }
    html = html.replace('</head>', `<script>${script}</script>\n</head>`);
    const headers = { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' };
    if (newToken) headers['Set-Cookie'] = `fc_session=${newToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
    res.writeHead(200, headers);
    res.end(html, 'utf-8');
  } catch (e) { res.writeHead(500); res.end('Erro ao servir aplicação'); }
}

async function serveMainApp(req, res) {
  const parsedUrl  = new URL(req.url, 'http://localhost');
  const simulateAs = parsedUrl.searchParams.get('simulate_as');
  const session    = await getSession(req);
  const liveDoc    = await db.loadLiveDoc();

  // Simulação: admin abre a visão de outro usuário em nova aba
  if (simulateAs && session && session.isAdmin) {
    const email = simulateAs.trim().toLowerCase();
    const users = await db.loadUsers();
    const simUser = users.users.find(u => u.email === email);
    if (!simUser) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<p>Usuário <b>${email}</b> não encontrado.</p>`);
      return;
    }
    const isAdmin = users.admins.includes(email);
    serveHtml(res, { email, isAdmin, name: simUser.name }, null, email, liveDoc);
    return;
  }

  // Já tem sessão válida → servir direto
  if (session) { serveHtml(res, session, null, null, liveDoc); return; }

  // Detectar usuário Windows automaticamente via whoami /upn
  let email;
  try {
    email = await getWindowsUPN();
  } catch (e) {
    res.writeHead(302, { Location: '/login' }); res.end(); return;
  }

  const users = await db.loadUsers();

  // Bootstrap: primeiro acesso vira admin automaticamente
  if (users.admins.length === 0 && users.users.length === 0) {
    users.admins.push(email);
    users.users.push({ email, name: email.split('@')[0] });
    await db.saveUsers(users);
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

  const isAdmin    = users.admins.includes(email);
  const userRecord = users.users.find(u => u.email === email) || { name: email.split('@')[0] };
  const token      = crypto.randomBytes(24).toString('hex');
  const userInfo   = { email, isAdmin, name: userRecord.name };
  await db.setSession(token, userInfo);
  serveHtml(res, userInfo, token, null, liveDoc);
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
    if (await getSession(req)) { res.writeHead(302, { Location: '/' }); res.end(); return; }
    try {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync('./pages/login.html', 'utf8'), 'utf-8');
    } catch (e) { res.writeHead(500); res.end('Login page not found'); }
    return;
  }

  if (req.url === '/api/auth/login' && req.method === 'POST') {
    try {
      const { email: rawEmail = '' } = await readBody(req);
      const email = rawEmail.trim().toLowerCase();
      if (!email || !email.includes('@')) { sendJson(res, 400, { ok: false, error: 'E-mail inválido' }); return; }

      const users = await db.loadUsers();

      if (users.admins.length === 0 && users.users.length === 0) {
        users.admins.push(email);
        users.users.push({ email, name: email.split('@')[0] });
        await db.saveUsers(users);
      } else if (!users.admins.includes(email) && !users.users.some(u => u.email === email)) {
        sendJson(res, 403, { ok: false, error: 'E-mail não autorizado. Solicite acesso ao administrador.' }); return;
      }

      const isAdmin    = users.admins.includes(email);
      const userRecord = users.users.find(u => u.email === email) || { email, name: email.split('@')[0] };
      const token      = crypto.randomBytes(24).toString('hex');
      await db.setSession(token, { email, isAdmin, name: userRecord.name });
      db.logAudit(email, 'login', `Login via e-mail`);
      notifyMainClients('audit_new', null);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `fc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
      });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // ── Microsoft OAuth ───────────────────────────────────────────────────────

  const host     = req.headers.host || `localhost:${PORT}`;
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl  = new URL(req.url, `${protocol}://${host}`);
  const pathname = baseUrl.pathname;

  if (pathname === '/auth/microsoft' && req.method === 'GET') {
    const redirectUri = `${protocol}://${host}/auth/callback`;
    const scope = 'openid email profile User.Read';
    const state = crypto.randomBytes(8).toString('hex');
    const authUrl = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/authorize?` +
      `client_id=${AZURE_CLIENT_ID}&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scope)}&state=${state}`;
    res.writeHead(302, { Location: authUrl }); res.end();
    return;
  }

  if (pathname === '/auth/callback' && req.method === 'GET') {
    const code        = baseUrl.searchParams.get('code');
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
          client_id: AZURE_CLIENT_ID, client_secret: AZURE_CLIENT_SECRET,
          code, redirect_uri: redirectUri, grant_type: 'authorization_code',
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const accessToken  = tokenResponse.data.access_token;
      const userResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const email = (userResponse.data.mail || userResponse.data.userPrincipalName || '').toLowerCase();
      if (!email || !email.includes('@')) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Erro</h1><p>Email não encontrado.</p><a href="/login">Voltar</a>');
        return;
      }

      const users      = await db.loadUsers();
      const userRecord = users.users.find(u => u.email === email);

      if (!userRecord && users.admins.length === 0 && users.users.length === 0) {
        users.admins.push(email);
        users.users.push({ email, name: userResponse.data.displayName || email.split('@')[0] });
        await db.saveUsers(users);
      } else if (!userRecord && !users.users.some(u => u.email === email)) {
        res.writeHead(403, { 'Content-Type': 'text/html' });
        res.end('<h1>Acesso Negado</h1><p>Seu email não está cadastrado.<br>Solicite acesso ao administrador.</p><a href="/login">Voltar</a>');
        return;
      }

      const isAdmin = users.admins.includes(email);
      const name    = userRecord?.name || userResponse.data.displayName || email.split('@')[0];
      const token   = crypto.randomBytes(24).toString('hex');
      await db.setSession(token, { email, isAdmin, name });
      db.logAudit(email, 'login', `Login via Microsoft OAuth`);
      notifyMainClients('audit_new', null);

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

  // ── User management (admin only) ──────────────────────────────────────────

  if (req.url === '/api/users' && req.method === 'GET') {
    const session = await getSession(req);
    if (!session || !session.isAdmin) { sendJson(res, 403, { ok: false, error: 'Acesso restrito' }); return; }
    sendJson(res, 200, { ok: true, data: await db.loadUsers() }); return;
  }

  if (req.url === '/api/users/export' && req.method === 'GET') {
    const session = await getSession(req);
    if (!session || !session.isAdmin) { sendJson(res, 403, { ok: false, error: 'Acesso restrito' }); return; }
    const users = await db.loadUsers();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="users.json"',
    });
    res.end(JSON.stringify(users, null, 2));
    return;
  }

  if (req.url === '/api/users/save' && req.method === 'POST') {
    const session = await getSession(req);
    if (!session || !session.isAdmin) { sendJson(res, 403, { ok: false, error: 'Acesso restrito' }); return; }
    try {
      const body = await readBody(req);
      if (!Array.isArray(body.admins) || !Array.isArray(body.users)) {
        sendJson(res, 400, { ok: false, error: 'Formato inválido' }); return;
      }
      const prev = await db.loadUsers();
      await db.saveUsers({ admins: body.admins, users: body.users });
      await db.updateSessionAdmins(body.admins);
      await db.revokeDeletedUserSessions(body.users.map(u => u.email));
      // Auditar mudanças de usuários
      const prevEmails = new Set(prev.users.map(u => u.email));
      const newEmails  = new Set(body.users.map(u => u.email));
      const auditEntries = [];
      for (const u of body.users) {
        if (!prevEmails.has(u.email)) auditEntries.push({ action: 'user_add', target: u.email, description: `Usuário adicionado: ${u.email}` });
      }
      for (const u of prev.users) {
        if (!newEmails.has(u.email)) auditEntries.push({ action: 'user_remove', target: u.email, description: `Usuário removido: ${u.email}` });
      }
      for (const email of body.admins) {
        if (!prev.admins.includes(email)) auditEntries.push({ action: 'user_admin_grant', target: email, description: `Admin concedido: ${email}` });
      }
      for (const email of prev.admins) {
        if (!body.admins.includes(email)) auditEntries.push({ action: 'user_admin_revoke', target: email, description: `Admin revogado: ${email}` });
      }
      if (auditEntries.length > 0) { db.batchLogAudit(session.email, auditEntries); notifyMainClients('audit_new', null); }
      notifyMainClients('users_updated', { admins: body.admins, users: body.users });
      sendJson(res, 200, { ok: true });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // ── Solicitações de acesso ────────────────────────────────────────────────

  // Usuário cria solicitação
  if (req.url === '/api/access-request' && req.method === 'POST') {
    const actualSession = await getSession(req);
    if (!actualSession) { sendJson(res, 401, { ok: false }); return; }
    try {
      const { nodeId, nodeTitle, simulateAs } = await readBody(req);
      // Admin simulando outro usuário: aceita se simulateAs for fornecido
      let actingEmail = actualSession.email;
      let actingName  = actualSession.name;
      if (simulateAs && actualSession.isAdmin) {
        actingEmail = simulateAs;
        const users = await db.loadUsers();
        const u = users.users.find(u => u.email === simulateAs);
        actingName = u ? u.name : simulateAs;
      } else if (actualSession.isAdmin) {
        sendJson(res, 400, { ok: false, error: 'Admin não precisa solicitar acesso' }); return;
      }
      if (!nodeId) { sendJson(res, 400, { ok: false, error: 'nodeId obrigatório' }); return; }
      const result = await db.createAccessRequest(nodeId, nodeTitle || '', actingEmail, actingName);
      if (!result.alreadyExists) {
        db.logAudit(actingEmail, 'access_request', `Acesso solicitado: "${nodeTitle || nodeId}"`, nodeId);
        notifyMainClients('audit_new', null);
        notifyMainClients('access_request_new', {
          id: result.id, nodeId, nodeTitle, requesterEmail: actingEmail, requesterName: actingName,
        });
      }
      sendJson(res, 200, { ok: true, id: result.id, alreadyExists: result.alreadyExists });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // Admin lista solicitações pendentes
  if (req.url === '/api/access-requests' && req.method === 'GET') {
    const session = await getSession(req);
    if (!session || !session.isAdmin) { sendJson(res, 403, { ok: false }); return; }
    try {
      const pending = await db.listAccessRequests('pending');
      sendJson(res, 200, { ok: true, requests: pending });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // Admin aprova ou reprova
  if (req.url === '/api/access-request/resolve' && req.method === 'POST') {
    const session = await getSession(req);
    if (!session || !session.isAdmin) { sendJson(res, 403, { ok: false }); return; }
    try {
      const { id, status } = await readBody(req);
      if (!['approved', 'denied'].includes(status)) { sendJson(res, 400, { ok: false, error: 'Status inválido' }); return; }
      const req_ = await db.resolveAccessRequest(id, status, session.email);
      if (!req_) { sendJson(res, 404, { ok: false }); return; }

      // Se aprovado, atualiza allowedUsers do nó no live_doc
      if (status === 'approved') {
        const doc = await db.loadLiveDoc();
        if (doc && Array.isArray(doc.nodes)) {
          const node = doc.nodes.find(n => n.id === req_.node_id);
          if (node) {
            if (!Array.isArray(node.allowedUsers)) node.allowedUsers = [];
            if (!node.allowedUsers.includes(req_.requester_email)) {
              node.allowedUsers.push(req_.requester_email);
            }
            await db.saveLiveDoc(doc);
            notifyMainClients('doc_updated', { by: session.email });
          }
        }
      }

      const actionKey = status === 'approved' ? 'access_approved' : 'access_denied';
      const actionLabel = status === 'approved' ? 'Acesso aprovado' : 'Acesso negado';
      db.logAudit(session.email, actionKey, `${actionLabel} para ${req_.requester_email}: "${req_.node_title || req_.node_id}"`, req_.node_id);
      notifyMainClients('audit_new', null);
      notifyMainClients('access_request_resolved', {
        nodeId: req_.node_id, status, requesterEmail: req_.requester_email,
      });
      sendJson(res, 200, { ok: true });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // Usuário consulta suas próprias solicitações
  if (req.url.startsWith('/api/access-request/mine') && req.method === 'GET') {
    const actualSession = await getSession(req);
    if (!actualSession) { sendJson(res, 401, { ok: false }); return; }
    try {
      const parsedMine = new URL(req.url, 'http://localhost');
      const simulateAs = parsedMine.searchParams.get('simulate_as');
      const email = (simulateAs && actualSession.isAdmin) ? simulateAs : actualSession.email;
      const map = await db.getMyAccessRequests(email);
      sendJson(res, 200, { ok: true, requests: map });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // ── Sync de doc live ──────────────────────────────────────────────────────

  if (req.url === '/api/doc/sync' && req.method === 'POST') {
    const session = await getSession(req);
    if (!session) { sendJson(res, 401, { ok: false, error: 'Não autenticado' }); return; }
    try {
      const body = await readBody(req);
      const effectiveBy = (body.simulateAs && session.isAdmin) ? body.simulateAs : session.email;
      if (body._baseNodes != null) {
        const serverDoc = await db.loadLiveDoc();
        const base = { nodes: body._baseNodes, edges: body._baseEdges || [], subflows: body._baseSubflows || {} };
        const merged = serverDoc ? mergeDoc(base, body, serverDoc) : body;
        await db.saveLiveDoc(merged);
        if (serverDoc) {
          const hasBaseline = !!body.auditBaseline;
          const auditBefore = body.auditBaseline || serverDoc;
          // Debug: loga diferenças de subflows entre auditBefore e merged
          const bSfDebug = auditBefore.subflows || {};
          const aSfDebug = merged.subflows || {};
          for (const k of new Set([...Object.keys(bSfDebug), ...Object.keys(aSfDebug)])) {
            if (JSON.stringify(bSfDebug[k] || null) !== JSON.stringify(aSfDebug[k] || null)) {
              const bStepsD = (bSfDebug[k]?.steps || []);
              const aStepsD = (aSfDebug[k]?.steps || []);
              console.log(`[audit-debug] subflow ${k}: hasBaseline=${hasBaseline} bSteps=${bStepsD.length} aSteps=${aStepsD.length}`);
              bStepsD.forEach((s, i) => console.log(`  [audit-debug] bStep[${i}] id=${s.id} title=${JSON.stringify(s.title)} desc=${JSON.stringify((s.desc||'').slice(0,40))} owner=${JSON.stringify(s.owner)}`));
              aStepsD.forEach((s, i) => console.log(`  [audit-debug] aStep[${i}] id=${s.id} title=${JSON.stringify(s.title)} desc=${JSON.stringify((s.desc||'').slice(0,40))} owner=${JSON.stringify(s.owner)}`));
            }
          }
          const changes = diffDocs(auditBefore, merged);
          if (changes.length > 0) { db.batchLogAudit(effectiveBy, changes); notifyMainClients('audit_new', null); }
        }
      } else {
        await db.saveLiveDoc(body);
      }
      notifyMainClients('doc_updated', { by: effectiveBy });
      sendJson(res, 200, { ok: true });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (req.url === '/api/doc/live' && req.method === 'GET') {
    const session = await getSession(req);
    if (!session) { sendJson(res, 401, { ok: false }); return; }
    try {
      const data = await db.loadLiveDoc();
      if (!data) { sendJson(res, 404, { ok: false }); return; }
      sendJson(res, 200, { ok: true, data });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // ── Imagens ───────────────────────────────────────────────────────────────

  if (req.url === '/api/images/upload' && req.method === 'POST') {
    if (!await getSession(req)) { sendJson(res, 401, { ok: false }); return; }
    // Rejeita uploads > 8 MB (base64 de ~6 MB de imagem)
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > 8 * 1024 * 1024) {
      sendJson(res, 413, { ok: false, error: 'Imagem muito grande (máximo 6 MB)' });
      return;
    }
    try {
      const { filename = 'image', data } = await readBody(req);
      const m = (data || '').match(/^data:([^;]+);base64,(.+)$/s);
      if (!m) { sendJson(res, 400, { ok: false, error: 'Dados inválidos' }); return; }
      // Validação de tamanho pelo conteúdo real (base64 ≈ 4/3 do binário)
      if (m[2].length > 8 * 1024 * 1024) {
        sendJson(res, 413, { ok: false, error: 'Imagem muito grande (máximo 6 MB)' });
        return;
      }
      const ext  = filename.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const safe = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
      // Salva sempre no banco de dados (fonte de verdade permanente)
      await db.saveImage(safe, m[1], m[2]);
      // Cache local para acelerar o serve (opcional, não crítico)
      try { fs.writeFileSync(path.join(IMAGES_DIR, safe), Buffer.from(m[2], 'base64')); } catch (_) {}
      sendJson(res, 200, { ok: true, url: `/api/images/${safe}` });
    } catch (e) {
      console.log('>>> ERRO UPLOAD:', e.message);
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  const imgServeMatch = req.url.match(/^\/api\/images\/([a-zA-Z0-9_\-.]+)$/);
  if (imgServeMatch && req.method === 'GET') {
    const fname    = imgServeMatch[1];
    const filepath = path.join(IMAGES_DIR, fname);
    const ext      = fname.split('.').pop().toLowerCase();
    const MIMES    = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
                       gif: 'image/gif',  webp: 'image/webp', svg: 'image/svg+xml' };

    // 1. Tenta arquivo local (cache)
    if (fs.existsSync(filepath)) {
      const mime = MIMES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'max-age=31536000' });
      res.end(fs.readFileSync(filepath));
      return;
    }

    // 2. Busca no banco de dados
    try {
      const img = await db.loadImage(fname);
      if (!img) {
        // no-store: impede que o browser cache o 404 e bloqueie tentativas futuras
        res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); return;
      }
      const mime   = img.mimetype || MIMES[ext] || 'application/octet-stream';
      const buffer = Buffer.from(img.data, 'base64');
      // Cacheia localmente para próximas requisições
      try { fs.writeFileSync(filepath, buffer); } catch (_) {}
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'max-age=31536000, immutable' });
      res.end(buffer);
    } catch (e) {
      console.log('>>> ERRO SERVE IMAGE:', fname, e.message);
      res.writeHead(500, { 'Cache-Control': 'no-store' }); res.end();
    }
    return;
  }

  // ── Backup ────────────────────────────────────────────────────────────────

  if (req.url === '/api/backup/save' && req.method === 'POST') {
    if (!await getSession(req)) { sendJson(res, 401, { ok: false, error: 'Não autenticado' }); return; }
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
      await db.saveBackup(filename, body.data);
      sendJson(res, 200, { ok: true, filename });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (req.url === '/api/backup/list' && req.method === 'GET') {
    if (!await getSession(req)) { sendJson(res, 401, { ok: false, error: 'Não autenticado' }); return; }
    try {
      sendJson(res, 200, { ok: true, files: await db.listBackups() });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  const loadMatch = req.url.match(/^\/api\/backup\/load\?file=(.+)$/);
  if (loadMatch && req.method === 'GET') {
    if (!await getSession(req)) { sendJson(res, 401, { ok: false, error: 'Não autenticado' }); return; }
    try {
      const filename = decodeURIComponent(loadMatch[1]).replace(/[/\\]/g, '');
      const data = await db.loadBackup(filename);
      if (!data) { sendJson(res, 404, { ok: false, error: 'Arquivo não encontrado' }); return; }
      sendJson(res, 200, { ok: true, data });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // ── Publish ───────────────────────────────────────────────────────────────

  if (req.url === '/api/publish/last-slug' && req.method === 'GET') {
    const session = await getSession(req);
    if (!session || !session.isAdmin) { sendJson(res, 403, { ok: false }); return; }
    try {
      const slug = await db.getLastPublishedSlug();
      sendJson(res, 200, { ok: true, slug: slug || '' });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (req.url === '/api/publish/save' && req.method === 'POST') {
    const session = await getSession(req);
    if (!session) { sendJson(res, 401, { ok: false, error: 'Não autenticado' }); return; }
    try {
      const body = await readBody(req);
      const slug = (body.slug || '').replace(/[^a-z0-9\-]/g, '').slice(0, 60);
      if (!slug) { sendJson(res, 400, { ok: false, error: 'Slug inválido' }); return; }
      await db.savePublished(slug, body.data);
      db.logAudit(session.email, 'publish', `Fluxo publicado com slug: "${slug}"`, slug);
      notifyMainClients('audit_new', null);
      notifySseClients(slug);
      sendJson(res, 200, { ok: true, slug });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // ── Status do banco (admin only) ─────────────────────────────────────────

  if (req.url === '/api/admin/db-status' && req.method === 'GET') {
    const session = await getSession(req);
    if (!session || !session.isAdmin) { sendJson(res, 403, { ok: false }); return; }
    const status = await db.getDbStatus();
    sendJson(res, 200, status);
    return;
  }

  // ── Auditoria (admin only) ────────────────────────────────────────────────

  if (req.url.startsWith('/api/audit') && req.method === 'GET') {
    const session = await getSession(req);
    if (!session || !session.isAdmin) { sendJson(res, 403, { ok: false }); return; }
    try {
      const u = new URL(req.url, 'http://localhost');
      const from   = u.searchParams.get('from')   || null;
      const to     = u.searchParams.get('to')     || null;
      const user   = u.searchParams.get('user')   || null;
      const action = u.searchParams.get('action') || null;
      const limit  = u.searchParams.get('limit')  || 100;
      const offset = u.searchParams.get('offset') || 0;
      const result = await db.getAuditLogs({ from, to, user, action, limit, offset });
      sendJson(res, 200, { ok: true, ...result });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (req.url === '/api/audit' && req.method === 'DELETE') {
    const session = await getSession(req);
    if (!session || !session.isAdmin) { sendJson(res, 403, { ok: false }); return; }
    const result = await db.clearAuditLogs();
    sendJson(res, 200, result);
    return;
  }

  const auditDeleteMatch = req.url.match(/^\/api\/audit\/(\d+)$/) ;
  if (auditDeleteMatch && req.method === 'DELETE') {
    const session = await getSession(req);
    if (!session || !session.isAdmin) { sendJson(res, 403, { ok: false }); return; }
    const result = await db.deleteAuditLog(parseInt(auditDeleteMatch[1], 10));
    sendJson(res, 200, result);
    return;
  }

  const publishMatch = req.url.match(/^\/api\/publish\/load\/([a-z0-9][a-z0-9\-]{0,59})$/);
  if (publishMatch && req.method === 'GET') {
    try {
      const data = await db.loadPublished(publishMatch[1]);
      if (!data) { sendJson(res, 404, { ok: false, error: 'Fluxo não encontrado' }); return; }
      sendJson(res, 200, { ok: true, data });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  // ── SSE: canal global (permissões e doc live) ─────────────────────────────

  if (req.url === '/api/events/__main__' && req.method === 'GET') {
    const session = await getSession(req);
    if (!session) { res.writeHead(401); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write(':\n\n');
    sseMainClients.add(res);
    const hb = setInterval(() => { try { res.write(':\n\n'); } catch (e) { clearInterval(hb); } }, 25000);
    req.on('close', () => { clearInterval(hb); sseMainClients.delete(res); });
    return;
  }

  // ── SSE: atualizações de fluxos publicados ────────────────────────────────

  const eventsMatch = req.url.match(/^\/api\/events\/([a-z0-9][a-z0-9\-]{0,59})$/);
  if (eventsMatch && req.method === 'GET') {
    const slug = eventsMatch[1];
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write(':\n\n');
    if (!sseClients.has(slug)) sseClients.set(slug, new Set());
    sseClients.get(slug).add(res);
    const hb = setInterval(() => { try { res.write(':\n\n'); } catch (e) { clearInterval(hb); } }, 25000);
    req.on('close', () => { clearInterval(hb); sseClients.get(slug)?.delete(res); });
    return;
  }

  // ── Published slug route (sem auth) ──────────────────────────────────────

  const slugRouteMatch = req.url.match(/^\/([a-z0-9][a-z0-9\-]{0,58}[a-z0-9]?)$/);
  if (slugRouteMatch && req.method === 'GET' && !RESERVED.has(slugRouteMatch[1])) {
    const slug = slugRouteMatch[1];
    if (await db.publishedExists(slug)) {
      try {
        let html = fs.readFileSync('./pages/Fluxograma Interativo.html', 'utf8');
        html = html.replace('</head>', `<script>window.__PUBLISHED_SLUG__="${slug}";</script>\n</head>`);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html, 'utf-8');
      } catch (e) { res.writeHead(500); res.end('Erro ao servir fluxo publicado'); }
      return;
    }
  }

  // ── Main app ──────────────────────────────────────────────────────────────

  if (req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/') {
    await serveMainApp(req, res); return;
  }

  if (req.method === 'GET' && req.url.includes('Fluxograma') && req.url.endsWith('.html')) {
    await serveMainApp(req, res); return;
  }

  // ── Static file fallback ──────────────────────────────────────────────────

  const filePath  = '.' + req.url;
  const extname   = String(path.extname(filePath)).toLowerCase();
  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<h1>404</h1>'); }
      else { res.writeHead(500); res.end('Erro no servidor: ' + error.code); }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// ── Inicializar DB e subir servidor ──────────────────────────────────────────

async function start() {
  try {
    await db.init();
    server.listen(PORT, () => {
      console.log(`\n✓ Servidor rodando em http://localhost:${PORT}\n`);
    });
  } catch (e) {
    console.error('\n✗ Falha ao conectar ao banco de dados:', e.message);
    console.error('  Verifique se o PostgreSQL está rodando e a variável DATABASE_URL está correta.');
    console.error('  Padrão local: postgresql://postgres:postgres@localhost:5432/fluxograma\n');
    process.exit(1);
  }
}

start();
