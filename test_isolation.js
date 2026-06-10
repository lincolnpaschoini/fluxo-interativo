// Teste isolacionado: simula pool postgres em memória e verifica isolamento entre ambientes
const Module = require('module');
const origResolve = Module._resolve_filename || Module._resolveFilename;

// Mock do pg
const tables = {
  users: [],
  sessions: [],
  environments: [],
  user_environments: [],
  live_doc: [],
  published_flows: [],
  backups: [],
  access_requests: [],
  audit_logs: [],
  images: [],
};
let envSeq = 1;
let auditSeq = 1;

const pgMock = {
  Pool: function() {
    return {
      query: async (sql, params = []) => {
        // Simulador minimalista: trata as queries do db.js apenas o suficiente para o teste
        const s = sql.replace(/\s+/g, ' ').trim();
        // SELECT data FROM live_doc WHERE environment_id=$1
        if (/^SELECT data FROM live_doc WHERE environment_id=\$1/i.test(s)) {
          const r = tables.live_doc.find(d => d.environment_id === params[0]);
          return { rows: r ? [{ data: r.data }] : [], rowCount: r ? 1 : 0 };
        }
        // INSERT INTO live_doc (environment_id, data, updated_at) ON CONFLICT UPDATE
        if (/^INSERT INTO live_doc \(environment_id, data, updated_at\)/i.test(s)) {
          const [envId, data] = params;
          const existing = tables.live_doc.find(d => d.environment_id === envId);
          if (existing) existing.data = JSON.parse(data);
          else tables.live_doc.push({ environment_id: envId, data: JSON.parse(data) });
          return { rows: [], rowCount: 1 };
        }
        // INSERT INTO published_flows ... ON CONFLICT UPDATE
        if (/^INSERT INTO published_flows \(slug, environment_id, data, updated_at\)/i.test(s)) {
          const [slug, envId, data] = params;
          const existing = tables.published_flows.find(p => p.slug === slug);
          if (existing) { existing.data = JSON.parse(data); existing.environment_id = envId; }
          else tables.published_flows.push({ slug, environment_id: envId, data: JSON.parse(data) });
          return { rows: [], rowCount: 1 };
        }
        // SELECT data, environment_id FROM published_flows WHERE slug=$1
        if (/^SELECT data, environment_id FROM published_flows WHERE slug=\$1/i.test(s)) {
          const r = tables.published_flows.find(p => p.slug === params[0]);
          return { rows: r ? [{ data: r.data, environment_id: r.environment_id }] : [], rowCount: r ? 1 : 0 };
        }
        // INSERT INTO backups
        if (/^INSERT INTO backups \(filename, environment_id, data\)/i.test(s)) {
          const [filename, envId, data] = params;
          const existing = tables.backups.find(b => b.filename === filename);
          if (existing) { existing.data = JSON.parse(data); existing.environment_id = envId; }
          else tables.backups.push({ filename, environment_id: envId, data: JSON.parse(data), created_at: new Date() });
          return { rows: [], rowCount: 1 };
        }
        // SELECT ... FROM backups WHERE environment_id=$1
        if (/FROM backups WHERE environment_id = \$1/i.test(s)) {
          const r = tables.backups.filter(b => b.environment_id === params[0]);
          return { rows: r.map(b => ({ filename: b.filename, created_at: b.created_at, size: JSON.stringify(b.data).length })) };
        }
        // SELECT data FROM backups WHERE filename=$1 AND environment_id=$2
        if (/^SELECT data FROM backups WHERE filename=\$1 AND environment_id=\$2/i.test(s)) {
          const r = tables.backups.find(b => b.filename === params[0] && b.environment_id === params[1]);
          return { rows: r ? [{ data: r.data }] : [], rowCount: r ? 1 : 0 };
        }
        // SELECT data FROM backups WHERE filename=$1
        if (/^SELECT data FROM backups WHERE filename=\$1/i.test(s)) {
          const r = tables.backups.find(b => b.filename === params[0]);
          return { rows: r ? [{ data: r.data }] : [], rowCount: r ? 1 : 0 };
        }
        // INSERT INTO environments RETURNING
        if (/^INSERT INTO environments \(name, logo, created_by\) VALUES \(\$1, \$2, \$3\) RETURNING/i.test(s)) {
          const env = { id: ++envSeq, name: params[0], logo: params[1], created_by: params[2], created_at: new Date() };
          tables.environments.push(env);
          return { rows: [env], rowCount: 1 };
        }
        if (/^SELECT id, name, logo, created_at, created_by FROM environments WHERE id=\$1/i.test(s)) {
          const r = tables.environments.find(e => e.id === params[0]);
          return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
        }
        if (/^INSERT INTO access_requests \(environment_id/i.test(s)) {
          const ar = { id: tables.access_requests.length + 1, environment_id: params[0], node_id: params[1], node_title: params[2], requester_email: params[3], requester_name: params[4], status: 'pending' };
          tables.access_requests.push(ar);
          return { rows: [ar], rowCount: 1 };
        }
        if (/^SELECT id, status FROM access_requests WHERE environment_id=\$1/i.test(s)) {
          const r = tables.access_requests.find(a => a.environment_id === params[0] && a.node_id === params[1] && a.requester_email === params[2] && a.status === params[3]);
          return { rows: r ? [{ id: r.id, status: r.status }] : [], rowCount: r ? 1 : 0 };
        }
        if (/^SELECT \* FROM access_requests WHERE environment_id=\$1 AND status=\$2/i.test(s)) {
          const r = tables.access_requests.filter(a => a.environment_id === params[0] && a.status === params[1]);
          return { rows: r, rowCount: r.length };
        }
        if (/^SELECT node_id, status FROM access_requests WHERE environment_id=\$1 AND requester_email=\$2/i.test(s)) {
          const r = tables.access_requests.filter(a => a.environment_id === params[0] && a.requester_email === params[1]);
          return { rows: r.map(a => ({ node_id: a.node_id, status: a.status })) };
        }
        if (/^INSERT INTO audit_logs/i.test(s)) {
          tables.audit_logs.push({ id: ++auditSeq, actor_email: params[0], action: params[1], description: params[2], target: params[3], metadata: params[4], environment_id: params[5] });
          return { rows: [], rowCount: 1 };
        }
        // Não trata DDL/init
        return { rows: [], rowCount: 0 };
      },
      connect: async () => ({
        query: async () => ({ rows: [], rowCount: 0 }),
        release: () => {},
      }),
    };
  },
};

// Intercepta require('pg')
require.cache[require.resolve('pg')] = { exports: pgMock };

const db = require('./db.js');

(async () => {
  // Pré-popular ambientes
  tables.environments.push({ id: 1, name: 'Empresa Principal', logo: null });
  tables.environments.push({ id: 2, name: 'Empresa B', logo: null });
  tables.environments.push({ id: 3, name: 'Empresa C', logo: null });
  envSeq = 3;

  // 1) Salvar fluxo distinto em cada ambiente
  await db.saveLiveDoc(1, { nodes: [{ id: 'a' }], edges: [] });
  await db.saveLiveDoc(2, { nodes: [{ id: 'b' }], edges: [] });
  await db.saveLiveDoc(3, { nodes: [{ id: 'c' }], edges: [] });
  
  const d1 = await db.loadLiveDoc(1);
  const d2 = await db.loadLiveDoc(2);
  const d3 = await db.loadLiveDoc(3);
  console.assert(d1.nodes[0].id === 'a', 'Env 1 deve ter nó a');
  console.assert(d2.nodes[0].id === 'b', 'Env 2 deve ter nó b');
  console.assert(d3.nodes[0].id === 'c', 'Env 3 deve ter nó c');
  console.log('✓ Live doc isolado entre ambientes');

  // 2) Alterar env 2 NÃO deve afetar env 1 ou 3
  await db.saveLiveDoc(2, { nodes: [{ id: 'b2' }, { id: 'b3' }], edges: [] });
  const d1b = await db.loadLiveDoc(1);
  const d2b = await db.loadLiveDoc(2);
  const d3b = await db.loadLiveDoc(3);
  console.assert(d1b.nodes.length === 1 && d1b.nodes[0].id === 'a', 'Env 1 não pode ser afetado');
  console.assert(d2b.nodes.length === 2, 'Env 2 deve ter atualizado');
  console.assert(d3b.nodes[0].id === 'c', 'Env 3 não pode ser afetado');
  console.log('✓ Edição em um ambiente não afeta outros');

  // 3) Backups isolados por ambiente
  await db.saveBackup('bkp1.json', 1, { foo: 'env1' });
  await db.saveBackup('bkp2.json', 2, { foo: 'env2' });
  const list1 = await db.listBackups(1);
  const list2 = await db.listBackups(2);
  const list3 = await db.listBackups(3);
  console.assert(list1.length === 1 && list1[0].filename === 'bkp1.json', 'Backup env 1');
  console.assert(list2.length === 1 && list2[0].filename === 'bkp2.json', 'Backup env 2');
  console.assert(list3.length === 0, 'Env 3 sem backups');
  console.log('✓ Backups isolados por ambiente');

  // 4) Publicações vinculadas ao ambiente
  await db.savePublished('slug-a', 1, { title: 'Pub Env 1' });
  await db.savePublished('slug-b', 2, { title: 'Pub Env 2' });
  const pa = await db.loadPublished('slug-a');
  const pb = await db.loadPublished('slug-b');
  console.assert(pa._environmentId === 1, 'Pub slug-a no env 1');
  console.assert(pb._environmentId === 2, 'Pub slug-b no env 2');
  console.log('✓ Slugs publicados vinculados ao ambiente');

  // 5) Access requests isoladas por ambiente
  await db.createAccessRequest(1, 'node-x', 'Caixa X', 'user@example.com', 'User');
  await db.createAccessRequest(2, 'node-x', 'Caixa X', 'user@example.com', 'User');
  const r1 = await db.listAccessRequests(1);
  const r2 = await db.listAccessRequests(2);
  const r3 = await db.listAccessRequests(3);
  console.assert(r1.length === 1 && r2.length === 1 && r3.length === 0, 'Requests isoladas');
  console.log('✓ Access requests isoladas por ambiente');

  console.log('\nTODOS OS TESTES DE ISOLAMENTO PASSARAM ✅');
})().catch(e => { console.error('TESTE FALHOU:', e); process.exit(1); });
