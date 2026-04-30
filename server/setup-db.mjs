#!/usr/bin/env node
/**
 * Supabase schema bootstrap for SUI Combats.
 *
 * Walks `server/src/data/migrations/*.sql` in lexical order and prints the
 * combined SQL the operator needs to paste into the Supabase SQL Editor.
 * The Supabase REST API does NOT expose raw SQL execution against project
 * databases (by design — service-role-only, not exposed via PostgREST), so
 * automated migration is impossible without a direct Postgres connection.
 *
 * Run this any time you add a new migration file:
 *
 *   $ cd server && node setup-db.mjs
 *
 * The script also probes the project to confirm whether the v1 tables
 * already exist, which is a useful smoke-test that creds + URL are valid.
 */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY in server/.env');
  console.error('See STATUS_v5.md → "Block B — Supabase setup walkthrough" for setup steps.');
  process.exit(1);
}

// Enumerate migrations in lexical order so 001_…, 002_…, etc. apply in
// the same order they were authored.
const migrationsDir = join(__dirname, 'src/data/migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (migrationFiles.length === 0) {
  console.error(`No .sql files found in ${migrationsDir}`);
  process.exit(1);
}

const combined = migrationFiles
  .map((name) => {
    const body = readFileSync(join(migrationsDir, name), 'utf8');
    return `-- ── ${name} ──────────────────────────────────────────\n${body}`;
  })
  .join('\n\n');

console.log('Found migrations:');
for (const name of migrationFiles) console.log(`  • ${name}`);
console.log('');

// Smoke-test: ping a known table from 001 to confirm creds + URL.
const probe = await fetch(
  `${SUPABASE_URL}/rest/v1/characters?select=wallet_address&limit=0`,
  {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  },
);

const charactersExist = probe.ok;
const wagerProbe = await fetch(
  `${SUPABASE_URL}/rest/v1/wager_in_flight?select=wager_match_id&limit=0`,
  {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  },
);
const wagerInFlightExists = wagerProbe.ok;

console.log(`characters table:      ${charactersExist ? '✓ EXISTS' : '✗ MISSING'}`);
console.log(`wager_in_flight table: ${wagerInFlightExists ? '✓ EXISTS' : '✗ MISSING'}`);
console.log('');

if (charactersExist && wagerInFlightExists) {
  console.log('All required tables exist. No migration needed.');
  console.log('(If you added a new migration file, paste it manually below.)');
  console.log('');
}

console.log('To apply (or re-apply) the schema:');
console.log('  1. Open your Supabase project → SQL Editor');
console.log('  2. Paste the SQL below into a new query');
console.log('  3. Click "Run"');
console.log('');
console.log('Migrations are idempotent — re-running on top of a partial schema is safe.');
console.log('');
console.log('────────── BEGIN SQL ──────────');
console.log(combined);
console.log('────────── END SQL ──────────');
