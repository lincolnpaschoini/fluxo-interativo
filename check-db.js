const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.argv[2],
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    const tables = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);
    console.log('\n=== TABELAS ===');
    console.log(tables.rows.map(r => r.tablename).join(', '));

    const users = await client.query('SELECT email, name, is_admin, created_at FROM users ORDER BY created_at');
    console.log('\n=== USUÁRIOS ===');
    console.table(users.rows);

    const sessions = await client.query('SELECT email, name, is_admin FROM sessions ORDER BY created_at DESC');
    console.log('\n=== SESSÕES ATIVAS ===');
    console.table(sessions.rows);

    const images = await client.query(`
      SELECT filename, mimetype, length(data) AS bytes, created_at FROM images ORDER BY created_at DESC
    `);
    console.log('\n=== IMAGENS ===');
    console.table(images.rows.map(r => ({ ...r, bytes: r.bytes + ' bytes' })));

    const backups = await client.query(`
      SELECT filename, created_at FROM backups ORDER BY created_at DESC
    `);
    console.log('\n=== BACKUPS ===');
    console.table(backups.rows);

    const liveDoc = await client.query('SELECT updated_at FROM live_doc WHERE id=1');
    console.log('\n=== LIVE DOC ===');
    console.log(liveDoc.rows.length ? `Última atualização: ${liveDoc.rows[0].updated_at}` : 'Vazio');

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('Erro:', e.message); process.exit(1); });
