const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.argv[2],
  ssl: { rejectUnauthorized: false },
});

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const DIR  = path.join(__dirname, 'data', 'images');

async function run() {
  const files = fs.readdirSync(DIR).filter(f => /\.(png|jpg|jpeg)$/i.test(f));
  console.log(`Encontrados ${files.length} arquivo(s) em data/images/`);
  let migrated = 0;
  for (const file of files) {
    const ext  = file.split('.').pop().toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const b64  = fs.readFileSync(path.join(DIR, file)).toString('base64');
    const r = await pool.query(
      'INSERT INTO images (filename, mimetype, data) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [file, mime, b64]
    );
    if (r.rowCount > 0) {
      console.log('  ✓ Migrado:', file, `(${Math.round(b64.length * 0.75 / 1024)} KB)`);
      migrated++;
    } else {
      console.log('  – Já existia:', file);
    }
  }
  console.log(`\n${migrated} imagem(ns) migrada(s).`);

  const { rows } = await pool.query('SELECT filename, length(data) AS bytes FROM images ORDER BY created_at DESC');
  console.log('\nImagens no banco:');
  rows.forEach(r => console.log(`  ${r.filename}  (${Math.round(r.bytes * 0.75 / 1024)} KB)`));
  await pool.end();
}

run().catch(e => { console.error('Erro:', e.message); process.exit(1); });
