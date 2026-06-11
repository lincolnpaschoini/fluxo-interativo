// Teste de regressao: garante que um sync sem subflows (beacon com localStorage ausente)
// NAO apaga os subflows do live_doc, e que auto.json e isolado por ambiente.
// Uso: node test-persistencia.js  (servidor precisa estar rodando na porta 8080)
const crypto = require('crypto');
const db = require('./db');

const BASE = 'http://localhost:8080';

async function post(path, token, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `fc_session=${token}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

(async () => {
  let envA = null, envB = null;
  const token = crypto.randomBytes(24).toString('hex');
  let failures = 0;
  const check = (name, cond, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${extra ? ' | ' + extra : ''}`);
    if (!cond) failures++;
  };
  try {
    envA = await db.createEnvironment({ name: '__TESTE_A__', createdBy: 'teste' });
    envB = await db.createEnvironment({ name: '__TESTE_B__', createdBy: 'teste' });
    await db.setSession(token, { email: 'lincoln.maxwel@paschoini.adv.br', name: 'Teste', isAdmin: true, currentEnvironmentId: envA.id });

    const doc = {
      nodes: [{ id: 'n1', label: 'No 1' }, { id: 'n2', label: 'No 2' }],
      edges: [{ from: 'n1', to: 'n2' }],
      subflows: { n1: { steps: [{ id: 's1', title: 'Etapa salva no modal' }] } },
      title: 'Teste',
    };
    await db.saveLiveDoc(envA.id, doc);

    // 1) Sync estilo "beacon na troca de ambiente": subflows null + base completa
    const r1 = await post('/api/doc/sync', token, {
      nodes: doc.nodes, edges: doc.edges, subflows: null, title: 'Teste',
      _baseNodes: doc.nodes, _baseEdges: doc.edges, _baseSubflows: null,
      environmentId: envA.id,
    });
    const after1 = await db.loadLiveDoc(envA.id);
    check('sync com subflows null preserva subflows', r1.status === 200 && after1 && Object.keys(after1.subflows || {}).length === 1,
      `status=${r1.status} subflows=${Object.keys(after1?.subflows || {}).length}`);

    // 2) Sync sem base (overwrite direto) com subflows null
    const r2 = await post('/api/doc/sync', token, {
      nodes: doc.nodes, edges: doc.edges, subflows: null, title: 'Teste', environmentId: envA.id,
    });
    const after2 = await db.loadLiveDoc(envA.id);
    check('overwrite com subflows null preserva subflows', r2.status === 200 && Object.keys(after2?.subflows || {}).length === 1,
      `status=${r2.status} subflows=${Object.keys(after2?.subflows || {}).length}`);

    // 3) Campos de controle nao sao persistidos no doc
    check('meta (_baseNodes/environmentId) nao persistido', !('_baseNodes' in (after2 || {})) && !('environmentId' in (after2 || {})));

    // 4) auto.json isolado por ambiente: sync no env B nao rouba o auto.json do env A
    const autoA1 = await db.loadBackup('auto.json', envA.id);
    const docB = { nodes: [{ id: 'b1', label: 'B1' }], edges: [], subflows: {}, title: 'B' };
    await db.saveLiveDoc(envB.id, docB);
    await post('/api/doc/sync', token, { ...docB, environmentId: envB.id });
    const autoA2 = await db.loadBackup('auto.json', envA.id);
    const autoB = await db.loadBackup('auto.json', envB.id);
    check('auto.json do env A sobrevive a sync no env B', !!autoA1 && !!autoA2 && (autoA2.nodes || []).length === 2,
      `A nodes=${(autoA2?.nodes || []).length}`);
    check('env B tem seu proprio auto.json', !!autoB && (autoB.nodes || []).length === 1);

    // 5) Delecao explicita de subflow continua funcionando (subflows {} com base contendo a chave)
    const r5 = await post('/api/doc/sync', token, {
      nodes: doc.nodes, edges: doc.edges, subflows: {}, title: 'Teste',
      _baseNodes: doc.nodes, _baseEdges: doc.edges, _baseSubflows: after2.subflows,
      environmentId: envA.id,
    });
    const after5 = await db.loadLiveDoc(envA.id);
    check('delecao explicita de subflows ainda funciona', r5.status === 200 && Object.keys(after5?.subflows || {}).length === 0,
      `status=${r5.status} subflows=${Object.keys(after5?.subflows || {}).length}`);
  } catch (e) {
    console.error('ERRO no teste:', e.message);
    failures++;
  } finally {
    try { if (envA) await db.deleteEnvironment(envA.id); } catch (_) {}
    try { if (envB) await db.deleteEnvironment(envB.id); } catch (_) {}
    try { await db.pool.query('DELETE FROM sessions WHERE token=$1', [token]); } catch (_) {}
    try { await db.pool.query(`DELETE FROM audit_logs WHERE actor_email='lincoln.maxwel@paschoini.adv.br' AND created_at > NOW() - INTERVAL '2 minutes' AND environment_id IS NULL`); } catch (_) {}
    await db.pool.end();
  }
  console.log(failures === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${failures} TESTE(S) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
