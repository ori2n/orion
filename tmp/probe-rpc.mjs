import { readFileSync } from 'node:fs';
const envText = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(
  envText.split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const ref = url.replace('https://','').replace('.supabase.co','');
const headers = {
  'Content-Type': 'application/json',
  apikey: key,
  Authorization: `Bearer ${key}`,
};

// Probe RPC endpoints
const rpcs = ['exec_sql','execute_sql','run_sql','query','admin_execute_sql','sql','_exec'];
console.log('--- RPC existence probe ---');
for (const fn of rpcs) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers,
    body: JSON.stringify({ query: 'SELECT 1' }),
  });
  console.log(`${fn.padEnd(22)} -> ${r.status} ${r.statusText}`);
}

// Try to list all exposed RPCs
console.log('\n--- Get all RPCs (GET /rest/v1/rpc) ---');
const r2 = await fetch(`${url}/rest/v1/rpc`, { method: 'GET', headers });
console.log('status:', r2.status);
try {
  const body = await r2.text();
  console.log('body (first 600 chars):', body.slice(0,600));
} catch(e) { console.log('error', e.message) }

// Try Management API
console.log('\n--- Supabase Management API probe ---');
const mgrHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
const r3 = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: mgrHeaders,
  body: JSON.stringify({ query: 'SELECT 1' }),
});
console.log('status:', r3.status);
console.log('body:', (await r3.text()).slice(0,400));
