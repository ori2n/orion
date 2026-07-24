import { readFileSync } from 'node:fs';
const envText = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = {
  'Content-Type': 'application/json',
  apikey: key,
  Authorization: `Bearer ${key}`,
};
async function probe(label, method, endpoint, body) {
  const r = await fetch(`${url}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = (await r.text()).slice(0, 300);
  console.log(`\n[${label}] ${method} ${endpoint}`);
  console.log(`  status: ${r.status} ${r.statusText}`);
  console.log(`  body: ${text}`);
}
await probe('list root', 'GET', '/pg/', null);
await probe('list /pg/query', 'GET', '/pg/query', null);
await probe('POST simple select', 'POST', '/pg/query', { query: 'SELECT 1' });
await probe('POST version', 'POST', '/pg/query', { query: 'SELECT version()' });
await probe('POST harmless DDL', 'POST', '/pg/query', { query: 'CREATE TABLE IF NOT EXISTS __probe_test_xyz (id int); SELECT count(*) FROM __probe_test_xyz;' });
await probe('POST drop probe', 'POST', '/pg/query', { query: 'DROP TABLE IF EXISTS __probe_test_xyz;' });
await probe('schemas', 'GET', '/pg/schemas', null);
await probe('tables', 'GET', '/pg/tables', null);
// also try without /pg prefix (postgres-meta in some versions)
await probe('legacy root', 'GET', '/postgres-meta/', null);
await probe('legacy tables', 'GET', '/postgres-meta/tables', null);
// Backup-style endpoints
await probe('sql root /sql', 'GET', '/sql', null);
await probe('sql POST', 'POST', '/sql', { query: 'SELECT 1' });
