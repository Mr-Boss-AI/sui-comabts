/**
 * Lobby rehydration gauntlet — pure unit tests, no chain/DB/SDK calls.
 *
 *   $ npx ts-node scripts/qa-lobby-rehydration.ts
 *
 * Pins the contract for the 2026-05-31 server-vs-chain drift fix
 * (server/src/data/lobby-rehydration.ts). After a server restart wipes
 * the in-memory wagerLobby map, the on-chain OpenWagerRegistry still
 * pins every live WAITING/PENDING_APPROVAL wager. This gauntlet drives
 * every status branch of the rehydration orchestrator with mocked deps:
 *
 *   STATUS_WAITING (0)            → adopt into lobby (with full data
 *                                   when DB has the character, or a
 *                                   placeholder name + chain level snapshot
 *                                   when the character row is missing)
 *   STATUS_PENDING_APPROVAL (3)   → adopt + carry pendingChallenger
 *   STATUS_ACTIVE (1)             → SKIP (orphan-recovery owns this)
 *   STATUS_SETTLED (2)            → SKIP (defensive — shouldn't appear in registry)
 *   unknown status                → SKIP + count.errors++
 *   readWagerFields returns null  → SKIP + count.errors++
 *   readRegistryEntries throws    → bail with count.errors++ and zero adoptions
 *
 * Exits 0 on full pass, 1 on any failure.
 */

import {
  rehydrateLobbyFromChain,
  buildLobbyEntry,
  placeholderName,
  type ChainWagerFields,
  type CharacterFacts,
  type RegistryEntry,
  type RehydrateDeps,
} from '../server/src/data/lobby-rehydration';
import type { WagerLobbyEntry } from '../server/src/types';

let passes = 0;
let failures = 0;

function ok(label: string): void {
  passes++;
  console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
}
function fail(label: string, detail: string): void {
  failures++;
  console.log(`  \x1b[31mFAIL\x1b[0m ${label}\n        ${detail}`);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) ok(label);
  else fail(label, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
function section(name: string): void {
  console.log(`\n\x1b[1m▸ ${name}\x1b[0m`);
}

// ============================================================================
// Fixtures
// ============================================================================

const SX = '0xd05ae8e26e9c239b4888822c83046fe7adaac243f46888ea430d852dafb6e92b';
const MR_BOSS = '0xf669789c0000000000000000000000000000000000000000000000000000af33';
const STRANGER = '0xa1b2c3d4e5f6789000000000000000000000000000000000000000000000abcd';

const WAGER_WAITING = '0x44018b2fc53d0c72045ec3a8cce23826fb321e94ff2ef11d8aec8161d2bfd6ef';
const WAGER_PENDING = '0xpend1111111111111111111111111111111111111111111111111111111111';
const WAGER_ACTIVE = '0xacti2222222222222222222222222222222222222222222222222222222222';
const WAGER_SETTLED = '0xsett3333333333333333333333333333333333333333333333333333333333';
const WAGER_UNKNOWN = '0xunkn4444444444444444444444444444444444444444444444444444444444';

function chainWaiting(): ChainWagerFields {
  return {
    status: 0,
    player_a: SX,
    player_a_level: 3,
    stake_amount: 100_000_000,
    created_at: 1780000000000,
    pending_challenger: null,
    pending_at: 0,
    challenger_escrow: 0,
  };
}
function chainPending(): ChainWagerFields {
  return {
    ...chainWaiting(),
    status: 3,
    pending_challenger: MR_BOSS,
    pending_at: 1780000300000,
    challenger_escrow: 100_000_000,
  };
}
function chainActive(): ChainWagerFields {
  return { ...chainWaiting(), status: 1 };
}
function chainSettled(): ChainWagerFields {
  return { ...chainWaiting(), status: 2 };
}
function chainUnknown(): ChainWagerFields {
  return { ...chainWaiting(), status: 7 };
}

function charSx(): CharacterFacts {
  return {
    id: 'char-sx',
    name: 'Sx',
    level: 5,
    rating: 1100,
    stats: { strength: 6, dexterity: 7, intuition: 4, endurance: 8 },
  };
}

// ============================================================================
// Mock dep builder
// ============================================================================

interface MockState {
  adopted: WagerLobbyEntry[];
  loadCharacterCalls: string[];
  readWagerFieldsCalls: string[];
  rejectedAdoptions: string[];
}

interface DepOpts {
  registry?: RegistryEntry[];
  /** Map from wagerMatchId → fields. null = simulate RPC null return. */
  wagerByid?: Record<string, ChainWagerFields | null>;
  /** Map from wallet → character facts. Missing = returns null (no DB row). */
  characters?: Record<string, CharacterFacts>;
  /** Throw on readRegistryEntries. */
  registryThrows?: Error;
  /** Throw on readWagerFields for specific ids. */
  wagerThrowsFor?: Record<string, Error>;
  /** Throw on loadCharacter for specific wallets. */
  loadCharThrowsFor?: Record<string, Error>;
  /** Have adoptIntoLobby reject (return false) for specific ids. */
  rejectAdoption?: Set<string>;
}

function buildDeps(opts: DepOpts, state: MockState): RehydrateDeps {
  return {
    readRegistryEntries: async () => {
      if (opts.registryThrows) throw opts.registryThrows;
      return opts.registry ?? [];
    },
    readWagerFields: async (id) => {
      state.readWagerFieldsCalls.push(id);
      const t = opts.wagerThrowsFor?.[id];
      if (t) throw t;
      return opts.wagerByid?.[id] ?? null;
    },
    loadCharacter: async (wallet) => {
      state.loadCharacterCalls.push(wallet);
      const t = opts.loadCharThrowsFor?.[wallet];
      if (t) throw t;
      return opts.characters?.[wallet] ?? null;
    },
    adoptIntoLobby: (entry) => {
      if (opts.rejectAdoption?.has(entry.wagerMatchId)) {
        state.rejectedAdoptions.push(entry.wagerMatchId);
        return false;
      }
      state.adopted.push(entry);
      return true;
    },
  };
}

function freshState(): MockState {
  return { adopted: [], loadCharacterCalls: [], readWagerFieldsCalls: [], rejectedAdoptions: [] };
}

// ============================================================================
// (A) buildLobbyEntry — pure mapping correctness
// ============================================================================

function testBuildLobbyEntryWaitingWithChar(): void {
  section('buildLobbyEntry — WAITING + character row → full hydration');
  const entry = buildLobbyEntry(WAGER_WAITING, chainWaiting(), charSx());
  if (!entry) {
    fail('returns an entry', 'buildLobbyEntry returned null');
    return;
  }
  eq(entry.wagerMatchId, WAGER_WAITING, 'wagerMatchId');
  eq(entry.creatorWallet, SX, 'creatorWallet');
  eq(entry.creatorCharacterId, 'char-sx', 'creatorCharacterId from DB');
  eq(entry.creatorName, 'Sx', 'creatorName from DB');
  eq(entry.creatorLevel, 5, 'creatorLevel from DB (NOT chain snapshot)');
  eq(entry.creatorRating, 1100, 'creatorRating from DB');
  eq(entry.wagerAmount, 0.1, 'wagerAmount derived from stake_amount/1e9');
  eq(entry.status, 0, 'status mirrors chain WAITING');
  eq(entry.playerALevelSnapshot, 3, 'playerALevelSnapshot from chain');
  eq(entry.pendingChallenger, undefined, 'WAITING has no pendingChallenger');
  // createdAt must be Date.now()-ish, NOT chain.created_at (else 10-min sweeper instantly wipes it)
  const ageMs = Date.now() - entry.createdAt;
  if (ageMs >= 0 && ageMs < 5000) ok('createdAt is server clock (not chain.created_at)');
  else fail('createdAt is server clock', `age=${ageMs}ms`);
}

function testBuildLobbyEntryWaitingPlaceholder(): void {
  section('buildLobbyEntry — WAITING + no DB row → placeholder hydration');
  const entry = buildLobbyEntry(WAGER_WAITING, chainWaiting(), null);
  if (!entry) {
    fail('returns an entry', 'buildLobbyEntry returned null with no char');
    return;
  }
  eq(entry.creatorName, placeholderName(SX), 'creatorName falls back to wallet-prefix placeholder');
  eq(entry.creatorLevel, 3, 'creatorLevel falls back to chain.player_a_level snapshot');
  eq(entry.creatorRating, 1000, 'creatorRating defaults to 1000');
  eq(entry.creatorStats.strength, 0, 'creatorStats.strength defaults to 0');
  eq(entry.creatorCharacterId.startsWith('rehydrated:'), true, 'creatorCharacterId is synthetic when no DB row');
}

function testBuildLobbyEntryPendingApproval(): void {
  section('buildLobbyEntry — PENDING_APPROVAL → carries pendingChallenger');
  const entry = buildLobbyEntry(WAGER_PENDING, chainPending(), charSx());
  if (!entry) {
    fail('returns an entry', 'buildLobbyEntry returned null for PENDING');
    return;
  }
  eq(entry.status, 3, 'status === STATUS_PENDING_APPROVAL');
  if (!entry.pendingChallenger) {
    fail('pendingChallenger populated', 'pendingChallenger is undefined for PENDING_APPROVAL');
    return;
  }
  eq(entry.pendingChallenger.wallet, MR_BOSS, 'pendingChallenger.wallet');
  eq(entry.pendingChallenger.name, placeholderName(MR_BOSS), 'pendingChallenger.name is placeholder');
  eq(entry.pendingChallenger.pendingAt, 1780000300000, 'pendingChallenger.pendingAt mirrors chain pending_at');
  eq(entry.pendingChallenger.rating, 1000, 'pendingChallenger.rating defaults to 1000');
}

function testBuildLobbyEntryActiveReturnsNull(): void {
  section('buildLobbyEntry — ACTIVE returns null (lobby is not the owner)');
  const entry = buildLobbyEntry(WAGER_ACTIVE, chainActive(), charSx());
  if (entry === null) ok('ACTIVE → null (orphan-recovery owns this row)');
  else fail('ACTIVE → null', 'buildLobbyEntry returned an entry for ACTIVE');
}

function testBuildLobbyEntrySettledReturnsNull(): void {
  section('buildLobbyEntry — SETTLED returns null (never resurrect)');
  const entry = buildLobbyEntry(WAGER_SETTLED, chainSettled(), charSx());
  if (entry === null) ok('SETTLED → null (never resurrect)');
  else fail('SETTLED → null', 'buildLobbyEntry returned an entry for SETTLED');
}

// ============================================================================
// (B) rehydrateLobbyFromChain — orchestrator branch coverage
// ============================================================================

async function testRehydrateAdoptsWaiting(): Promise<void> {
  section('rehydrateLobbyFromChain — WAITING entry is adopted');
  const state = freshState();
  const deps = buildDeps({
    registry: [{ creatorWallet: SX, wagerMatchId: WAGER_WAITING }],
    wagerByid: { [WAGER_WAITING]: chainWaiting() },
    characters: { [SX]: charSx() },
  }, state);
  const r = await rehydrateLobbyFromChain(deps);
  eq(r.registryEntries, 1, 'registryEntries == 1');
  eq(r.adopted, 1, 'adopted == 1');
  eq(r.skippedActive, 0, 'skippedActive == 0');
  eq(r.skippedSettled, 0, 'skippedSettled == 0');
  eq(r.errors, 0, 'errors == 0');
  eq(state.adopted.length, 1, 'one entry passed to adoptIntoLobby');
  eq(state.adopted[0]?.creatorName, 'Sx', 'adopted entry uses DB name');
}

async function testRehydrateAdoptsPendingApproval(): Promise<void> {
  section('rehydrateLobbyFromChain — PENDING_APPROVAL entry is adopted with challenger');
  const state = freshState();
  const deps = buildDeps({
    registry: [{ creatorWallet: SX, wagerMatchId: WAGER_PENDING }],
    wagerByid: { [WAGER_PENDING]: chainPending() },
    characters: { [SX]: charSx() },
  }, state);
  const r = await rehydrateLobbyFromChain(deps);
  eq(r.adopted, 1, 'adopted == 1');
  if (state.adopted[0]?.pendingChallenger?.wallet === MR_BOSS) {
    ok('adopted entry carries pendingChallenger.wallet = MR_BOSS');
  } else {
    fail('pendingChallenger.wallet correct', `got ${JSON.stringify(state.adopted[0]?.pendingChallenger)}`);
  }
}

async function testRehydrateSkipsActive(): Promise<void> {
  section('rehydrateLobbyFromChain — ACTIVE entry is skipped (orphan-recovery owns it)');
  const state = freshState();
  const deps = buildDeps({
    registry: [{ creatorWallet: SX, wagerMatchId: WAGER_ACTIVE }],
    wagerByid: { [WAGER_ACTIVE]: chainActive() },
  }, state);
  const r = await rehydrateLobbyFromChain(deps);
  eq(r.skippedActive, 1, 'skippedActive == 1');
  eq(r.adopted, 0, 'adopted == 0');
  eq(state.loadCharacterCalls.length, 0, 'no character load attempted for ACTIVE (short-circuits)');
}

async function testRehydrateSkipsSettled(): Promise<void> {
  section('rehydrateLobbyFromChain — SETTLED entry is skipped (defensive; never resurrect)');
  const state = freshState();
  const deps = buildDeps({
    registry: [{ creatorWallet: SX, wagerMatchId: WAGER_SETTLED }],
    wagerByid: { [WAGER_SETTLED]: chainSettled() },
  }, state);
  const r = await rehydrateLobbyFromChain(deps);
  eq(r.skippedSettled, 1, 'skippedSettled == 1');
  eq(r.adopted, 0, 'adopted == 0 (SETTLED never resurrected)');
}

async function testRehydrateUnknownStatusIsError(): Promise<void> {
  section('rehydrateLobbyFromChain — unknown status is an error, not adopted');
  const state = freshState();
  const deps = buildDeps({
    registry: [{ creatorWallet: SX, wagerMatchId: WAGER_UNKNOWN }],
    wagerByid: { [WAGER_UNKNOWN]: chainUnknown() },
  }, state);
  const r = await rehydrateLobbyFromChain(deps);
  eq(r.errors, 1, 'errors == 1 for unknown status');
  eq(r.adopted, 0, 'adopted == 0');
}

async function testRehydrateNullFieldsIsError(): Promise<void> {
  section('rehydrateLobbyFromChain — readWagerFields → null counts as error');
  const state = freshState();
  const deps = buildDeps({
    registry: [{ creatorWallet: SX, wagerMatchId: WAGER_WAITING }],
    wagerByid: { [WAGER_WAITING]: null },
  }, state);
  const r = await rehydrateLobbyFromChain(deps);
  eq(r.errors, 1, 'errors == 1');
  eq(r.adopted, 0, 'adopted == 0');
}

async function testRehydrateMixedRegistry(): Promise<void> {
  section('rehydrateLobbyFromChain — mixed registry: WAITING + PENDING + ACTIVE + SETTLED + unknown');
  const state = freshState();
  const deps = buildDeps({
    registry: [
      { creatorWallet: SX, wagerMatchId: WAGER_WAITING },
      { creatorWallet: MR_BOSS, wagerMatchId: WAGER_PENDING },
      { creatorWallet: STRANGER, wagerMatchId: WAGER_ACTIVE },
      { creatorWallet: STRANGER, wagerMatchId: WAGER_SETTLED },
      { creatorWallet: STRANGER, wagerMatchId: WAGER_UNKNOWN },
    ],
    wagerByid: {
      [WAGER_WAITING]: chainWaiting(),
      [WAGER_PENDING]: chainPending(),
      [WAGER_ACTIVE]: chainActive(),
      [WAGER_SETTLED]: chainSettled(),
      [WAGER_UNKNOWN]: chainUnknown(),
    },
    characters: { [SX]: charSx() },
  }, state);
  const r = await rehydrateLobbyFromChain(deps);
  eq(r.registryEntries, 5, 'registryEntries == 5');
  eq(r.adopted, 2, 'adopted == 2 (WAITING + PENDING)');
  eq(r.skippedActive, 1, 'skippedActive == 1');
  eq(r.skippedSettled, 1, 'skippedSettled == 1');
  eq(r.errors, 1, 'errors == 1 (unknown status)');
  const adoptedIds = state.adopted.map(e => e.wagerMatchId).sort();
  const expected = [WAGER_PENDING, WAGER_WAITING].sort();
  eq(JSON.stringify(adoptedIds), JSON.stringify(expected), 'adopted ids = [WAITING, PENDING]');
}

async function testRehydrateRegistryReadThrows(): Promise<void> {
  section('rehydrateLobbyFromChain — readRegistryEntries throws → bail safely with errors++');
  const state = freshState();
  const deps = buildDeps({ registryThrows: new Error('grpc unavailable') }, state);
  const r = await rehydrateLobbyFromChain(deps);
  eq(r.adopted, 0, 'adopted == 0');
  eq(r.errors, 1, 'errors == 1');
  eq(state.adopted.length, 0, 'no adoption attempted');
}

async function testRehydratePerWagerReadThrows(): Promise<void> {
  section('rehydrateLobbyFromChain — readWagerFields throws on one id → others still adopt');
  const state = freshState();
  const deps = buildDeps({
    registry: [
      { creatorWallet: SX, wagerMatchId: WAGER_WAITING },
      { creatorWallet: MR_BOSS, wagerMatchId: WAGER_PENDING },
    ],
    wagerByid: { [WAGER_PENDING]: chainPending() },
    wagerThrowsFor: { [WAGER_WAITING]: new Error('rpc-flaky') },
    characters: { [SX]: charSx() },
  }, state);
  const r = await rehydrateLobbyFromChain(deps);
  eq(r.errors, 1, 'errors == 1 (the throw)');
  eq(r.adopted, 1, 'adopted == 1 (the survivor)');
  eq(state.adopted[0]?.wagerMatchId, WAGER_PENDING, 'survivor is the PENDING one');
}

async function testRehydrateLoadCharThrowsIsRecoverable(): Promise<void> {
  section('rehydrateLobbyFromChain — loadCharacter throw → placeholder adoption (non-fatal)');
  const state = freshState();
  const deps = buildDeps({
    registry: [{ creatorWallet: SX, wagerMatchId: WAGER_WAITING }],
    wagerByid: { [WAGER_WAITING]: chainWaiting() },
    loadCharThrowsFor: { [SX]: new Error('supabase down') },
  }, state);
  const r = await rehydrateLobbyFromChain(deps);
  eq(r.adopted, 1, 'adopted == 1 — char load failure must not block lobby visibility');
  eq(state.adopted[0]?.creatorName, placeholderName(SX), 'fell back to placeholder name');
}

async function testRehydrateAdoptionRejected(): Promise<void> {
  section('rehydrateLobbyFromChain — adoptIntoLobby returns false → counts as not-adopted, no error');
  const state = freshState();
  const deps = buildDeps({
    registry: [{ creatorWallet: SX, wagerMatchId: WAGER_WAITING }],
    wagerByid: { [WAGER_WAITING]: chainWaiting() },
    characters: { [SX]: charSx() },
    rejectAdoption: new Set([WAGER_WAITING]),
  }, state);
  const r = await rehydrateLobbyFromChain(deps);
  eq(r.adopted, 0, 'adopted == 0 (the lobby already had it)');
  eq(r.errors, 0, 'errors == 0 (rejection is not an error)');
  eq(state.rejectedAdoptions.length, 1, 'rejection recorded by the mock');
}

async function testRehydrateEmptyRegistry(): Promise<void> {
  section('rehydrateLobbyFromChain — empty registry is a clean boot');
  const state = freshState();
  const r = await rehydrateLobbyFromChain(buildDeps({ registry: [] }, state));
  eq(r.registryEntries, 0, 'registryEntries == 0');
  eq(r.adopted, 0, 'adopted == 0');
  eq(r.errors, 0, 'errors == 0');
}

// ============================================================================
// Runner
// ============================================================================

async function main(): Promise<void> {
  testBuildLobbyEntryWaitingWithChar();
  testBuildLobbyEntryWaitingPlaceholder();
  testBuildLobbyEntryPendingApproval();
  testBuildLobbyEntryActiveReturnsNull();
  testBuildLobbyEntrySettledReturnsNull();

  await testRehydrateAdoptsWaiting();
  await testRehydrateAdoptsPendingApproval();
  await testRehydrateSkipsActive();
  await testRehydrateSkipsSettled();
  await testRehydrateUnknownStatusIsError();
  await testRehydrateNullFieldsIsError();
  await testRehydrateMixedRegistry();
  await testRehydrateRegistryReadThrows();
  await testRehydratePerWagerReadThrows();
  await testRehydrateLoadCharThrowsIsRecoverable();
  await testRehydrateAdoptionRejected();
  await testRehydrateEmptyRegistry();

  console.log(`\n${failures === 0 ? '\x1b[32m✔' : '\x1b[31m✘'} ${passes} pass / ${failures} fail\x1b[0m\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('GAUNTLET CRASH:', err);
  process.exit(1);
});
