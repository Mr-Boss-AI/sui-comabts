#!/usr/bin/env node
// Run Supabase migration — creates tables for SUI Combats
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY in server/.env');
  process.exit(1);
}

const sql = readFileSync(join(__dirname, 'src/data/migrations/001_initial.sql'), 'utf8');

// Split SQL into individual statements
const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'));

console.log(`Running ${statements.length} SQL statements...\n`);

let success = 0;
let failed = 0;

for (const stmt of statements) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: stmt }),
  });

  if (res.ok) {
    success++;
  } else {
    failed++;
  }
}

if (failed > 0) {
  console.log('Direct SQL execution not supported via REST API (expected).');
  console.log('Please run the SQL migration manually:\n');
  console.log('1. Go to your Supabase project dashboard → SQL Editor');
  console.log('2. Paste the contents of: server/src/data/migrations/001_initial.sql');
  console.log('3. Click "Run"\n');

  // Also try to verify if tables already exist
  const testRes = await fetch(`${SUPABASE_URL}/rest/v1/characters?select=wallet_address&limit=0`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (testRes.ok) {
    console.log('Tables already exist! No migration needed.');
  } else {
    console.log('Tables do NOT exist yet — migration required.');
    console.log('\nSQL to run:\n');
    console.log(sql);
  }
} else {
  console.log(`All ${success} statements executed successfully!`);
}
