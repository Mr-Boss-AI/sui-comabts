#!/usr/bin/env node
// Run Supabase migration — creates tables for SUI Combats
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://illqnrcjhvzbpmdlllmk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsbHFucmNqaHZ6YnBtZGxsbG1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNjA3NTIsImV4cCI6MjA5MTczNjc1Mn0.xZawT-L91U8lqke8VjhpECTaOt8ifoX_cei9gSTwPXo';

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
  // Use Supabase's PostgREST RPC — try the pg_net or direct approach
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
  console.log('1. Go to https://supabase.com/dashboard/project/illqnrcjhvzbpmdlllmk/sql');
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
