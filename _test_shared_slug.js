const tables = { environments: [], live_doc: [], published_flows: [], backups: [], access_requests: [], audit_logs: [], users: [], user_environments: [], sessions: [], images: [] };

const pgMock = {
  Pool: function() {
    return {
      query: async (sql, params = []) => {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (/^INSERT INTO published_flows \(slug, environment_id, data, updated_at\)/i.test(s)) {
          const [slug, envId, data] = params;
          const existing = tables.published_flows.find(p => p.slug === slug && p.environment_id === envId);
          if (existing) { existing.data = JSON.parse(data); existing.updated_at = new Date(); }
          else tables.published_flows.push({ slug, environment_id: envId, data: JSON.parse(data), updated_at: new Date() });
          return { rows: [], rowCount: 1 };
        }
        if (/^SELECT data, environment_id FROM published_flows WHERE slug=\$1 AND environment_id=\$2/i.test(s)) {
          const r = tables.published_flows.find(p => p.slug === params[0] && p.environment_id === params[1]);
          return { rows: r ? [{ data: r.data, environment_id: r.environment_id }] : [] };
        }
        if (/^SELECT data, environment_id FROM published_flows WHERE slug=\$1$/i.test(s)) {
          const r = tables.published_flows.filter(p => p.slug === params[0]);
          return { rows: r.map(p => ({ data: p.data, environment_id: p.environment_id })) };
        }
        if (/^SELECT 1 FROM published_flows WHERE slug=\$1 LIMIT 1/i.test(s)) {
          const r = tables.published_flows.filter(p => p.slug === params[0]);
          return { rows: r.length ? [{ '?column?': 1 }] : [] };
        }
        if (/FROM published_flows p JOIN environments e/i.test(s)) {
          const pubs = tables.published_flows.filter(p => p.slug === params[0]);
          return { rows: pubs.map(p => {
            const e = tables.environments.find(x => x.id === p.environment_id);
            return { id: p.environment_id, name: e?.name, logo: e?.logo, updated_at: p.updated_at };
          })};
        }
        return { rows: [], rowCount: 0 };
      },
      connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => {} }),
    };
  },
};
require.cache[require.resolve('pg')] = { exports: pgMock };

const db = require('./db.js');
(async () => {
  tables.environments.push({ id: 1, name: 'Empresa Principal', logo: null });
  tables.environments.push({ id: 2, name: 'Empresa B', logo: 'logo-b.png' });
  tables.environments.push({ id: 3, name: 'Empresa C', logo: null });

  // 1) Publicar o mesmo slug em 3 ambientes diferentes
  await db.savePublished('jornada-cliente', 1, { title: 'Fluxo A', nodes: [{ id: 'na' }] });
  await db.savePublished('jornada-cliente', 2, { title: 'Fluxo B', nodes: [{ id: 'nb' }] });
  await db.savePublished('jornada-cliente', 3, { title: 'Fluxo C', nodes: [{ id: 'nc' }] });
  console.log('✓ Publicou mesmo slug em 3 ambientes (nao houve erro)');

  // 2) Listar ambientes do slug
  const envs = await db.listPublishedEnvsBySlug('jornada-cliente');
  console.assert(envs.length === 3, `Deveria ter 3 envs, tem ${envs.length}`);
  console.assert(envs.map(e => e.id).sort().join(',') === '1,2,3', 'ids errados');
  console.log('✓ listPublishedEnvsBySlug retorna 3 ambientes com nome+logo:', envs.map(e => `${e.id}=${e.name}`).join(', '));

  // 3) loadPublished com envId carrega o fluxo correto
  const docA = await db.loadPublished('jornada-cliente', 1);
  const docB = await db.loadPublished('jornada-cliente', 2);
  const docC = await db.loadPublished('jornada-cliente', 3);
  console.assert(docA.title === 'Fluxo A' && docA._environmentId === 1, 'docA errado');
  console.assert(docB.title === 'Fluxo B' && docB._environmentId === 2, 'docB errado');
  console.assert(docC.title === 'Fluxo C' && docC._environmentId === 3, 'docC errado');
  console.log('✓ loadPublished(slug, envId) carrega corretamente cada ambiente');

  // 4) loadPublished sem envId retorna null (ambiguidade) quando ha varios
  const docAmbig = await db.loadPublished('jornada-cliente');
  console.assert(docAmbig === null, 'Deveria ser null quando ha multiplos');
  console.log('✓ loadPublished sem envId retorna null quando ha multiplas publicacoes');

  // 5) publishedExists retorna true
  const exists = await db.publishedExists('jornada-cliente');
  console.assert(exists === true, 'publishedExists deveria ser true');
  console.log('✓ publishedExists retorna true');

  // 6) Atualizar ambiente 2 nao afeta os outros
  await db.savePublished('jornada-cliente', 2, { title: 'Fluxo B v2', nodes: [{ id: 'nb1' }, { id: 'nb2' }] });
  const docA2 = await db.loadPublished('jornada-cliente', 1);
  const docB2 = await db.loadPublished('jornada-cliente', 2);
  console.assert(docA2.title === 'Fluxo A', 'docA nao pode ter sido alterado');
  console.assert(docB2.title === 'Fluxo B v2' && docB2.nodes.length === 2, 'docB deveria estar v2');
  console.log('✓ Atualizar publicacao de um ambiente nao afeta outros');

  console.log('\n✅ TODOS OS TESTES DE SHARED SLUG PASSARAM');
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
