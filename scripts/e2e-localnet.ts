/**
 * End-to-end contract + combat run against a LOCAL Sui network (v5.3).
 *
 *   # terminal 1 — throwaway local chain with faucet
 *   $ sui start --with-faucet --force-regenesis
 *   # terminal 2
 *   $ cd server && SUI_PACKAGE_ID=0x1 ADMIN_CAP_ID=0x1 PLATFORM_TREASURY=0x1 \
 *       SUI_TREASURY_PRIVATE_KEY=dummy npx tsx ../scripts/e2e-localnet.ts
 *
 * What it does:
 *   1. Generates 5 wallets (TREASURY + 4 players), funds them from the faucet.
 *   2. Copies `contracts/` to a temp dir, swaps the hardcoded arena TREASURY
 *      address for the local TREASURY wallet (the real package is untouched),
 *      builds and publishes it.
 *   3. Runs real transactions for characters, guilds, 1v1 wagers, items and
 *      equipment — every happy path plus the abort paths that guard them.
 *   4. Runs simulated battles through the real server combat engine using the
 *      characters' on-chain stats and on-chain equipped items.
 *
 * Exits 0 when every check passes, 1 otherwise. Never touches testnet.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

const RPC = process.env.LOCALNET_RPC ?? 'http://127.0.0.1:9000';
const FAUCET = process.env.LOCALNET_FAUCET ?? 'http://127.0.0.1:9123/v2/gas';
const SUI_BIN = process.env.SUI_BIN ?? 'sui';
const CLOCK = '0x6';
const SUI = 1_000_000_000n;

const client = new SuiJsonRpcClient({ url: RPC, network: 'localnet' } as any);

// ---------------------------------------------------------------- reporting
let passes = 0;
let failures = 0;
const failed: string[] = [];
function ok(label: string) { passes++; console.log(`  \x1b[32mPASS\x1b[0m ${label}`); }
function bad(label: string, detail: string) {
  failures++; failed.push(label);
  console.log(`  \x1b[31mFAIL\x1b[0m ${label}\n        ${detail}`);
}
function check(cond: boolean, label: string, detail = '') { cond ? ok(label) : bad(label, detail || 'condition false'); }
function section(t: string) { console.log(`\n\x1b[1m[${t}]\x1b[0m`); }

// ---------------------------------------------------------------- wallets
type Wallet = { name: string; kp: Ed25519Keypair; addr: string };
function wallet(name: string): Wallet {
  const kp = new Ed25519Keypair();
  return { name, kp, addr: kp.getPublicKey().toSuiAddress() };
}
const TREASURY = wallet('TREASURY');
const ALICE = wallet('ALICE');
const BOB = wallet('BOB');
const CAROL = wallet('CAROL');
const DAVE = wallet('DAVE');

async function fund(w: Wallet) {
  const res = await fetch(FAUCET, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ FixedAmountRequest: { recipient: w.addr } }),
  });
  if (!res.ok) throw new Error(`faucet ${res.status} for ${w.name}`);
  for (let i = 0; i < 40; i++) {
    const b = await client.getBalance({ owner: w.addr });
    if (BigInt(b.totalBalance) > 0n) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`faucet never funded ${w.name}`);
}

// ---------------------------------------------------------------- tx helpers
type Res = Awaited<ReturnType<typeof client.signAndExecuteTransaction>>;

async function run(w: Wallet, build: (tx: Transaction) => void): Promise<Res> {
  const tx = new Transaction();
  build(tx);
  const res = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: w.kp,
    options: { showEffects: true, showObjectChanges: true, showBalanceChanges: true, showEvents: true },
  });
  await client.waitForTransaction({ digest: res.digest });
  return res;
}

async function mustRun(w: Wallet, label: string, build: (tx: Transaction) => void): Promise<Res> {
  const res = await run(w, build);
  const st = res.effects?.status;
  if (st?.status !== 'success') {
    bad(label, `tx failed: ${st?.error}`);
    throw new Error(`${label} failed — cannot continue`);
  }
  ok(label);
  return res;
}

/** Expect a MoveAbort with `code` raised inside `module`. */
async function mustAbort(w: Wallet, label: string, module: string, code: number, build: (tx: Transaction) => void) {
  let err = '';
  try {
    const res = await run(w, build);
    if (res.effects?.status?.status === 'success') { bad(label, 'tx SUCCEEDED but should have aborted'); return; }
    err = res.effects?.status?.error ?? '';
  } catch (e: any) {
    err = String(e?.message ?? e);
  }
  // Two error shapes depending on node version:
  //   "MoveAbort in 1st command, abort code: 15, in '0x…::guild::withdraw'"
  //   "MoveAbort(MoveLocation { … name: Identifier(\"guild\") … }, 15)"
  let gotModule = '', gotCode = -1;
  const a = err.match(/abort code:\s*(\d+),\s*in '0x[0-9a-f]+::(\w+)::/);
  const b = err.match(/Identifier\("(\w+)"\)[\s\S]*?\},\s*(\d+)\)/);
  if (a) { gotCode = Number(a[1]); gotModule = a[2]; }
  else if (b) { gotModule = b[1]; gotCode = Number(b[2]); }
  if (gotModule === module && gotCode === code) ok(`${label} → aborts ${module}::${code}`);
  else bad(label, `expected abort ${module}::${code}, got: ${err.slice(0, 300)}`);
}

/** Expect the transaction to be rejected for any reason (e.g. using an
 *  object the signer does not own — rejected before Move runs). */
async function mustFail(w: Wallet, label: string, build: (tx: Transaction) => void) {
  try {
    const res = await run(w, build);
    if (res.effects?.status?.status === 'success') { bad(label, 'tx SUCCEEDED but should have been rejected'); return; }
    ok(`${label} → rejected`);
  } catch (e: any) {
    ok(`${label} → rejected (${String(e?.message ?? e).split('\n')[0].slice(0, 80)})`);
  }
}

function created(res: Res, typeSuffix: string): string {
  const c = (res.objectChanges ?? []).find(
    (o: any) => o.type === 'created' && typeof o.objectType === 'string' && o.objectType.endsWith(typeSuffix),
  ) as any;
  if (!c) throw new Error(`no created object of type *${typeSuffix}`);
  return c.objectId;
}

function balanceDelta(res: Res, owner: string): bigint {
  let d = 0n;
  for (const b of res.balanceChanges ?? []) {
    const o: any = b.owner;
    if (o?.AddressOwner === owner && b.coinType.endsWith('::sui::SUI')) d += BigInt(b.amount);
  }
  return d;
}

function gasOf(res: Res): bigint {
  const g = res.effects!.gasUsed;
  return BigInt(g.computationCost) + BigInt(g.storageCost) - BigInt(g.storageRebate);
}

async function fields(id: string): Promise<any> {
  const o = await client.getObject({ id, options: { showContent: true } });
  return (o.data?.content as any)?.fields;
}

function num(v: any): bigint {
  if (typeof v === 'string' || typeof v === 'number') return BigInt(v);
  if (v && typeof v === 'object' && 'value' in v) return BigInt(v.value);
  if (v && typeof v === 'object' && v.fields) return num(v.fields.value ?? v.fields);
  return 0n;
}

// ---------------------------------------------------------------- publish
function buildPackage(): { modules: string[]; dependencies: string[] } {
  const src = path.resolve(__dirname, '../contracts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sui-combats-e2e-'));
  fs.cpSync(src, dir, { recursive: true, filter: (p) => !p.includes(`${path.sep}build`) });
  const arena = path.join(dir, 'sources', 'arena.move');
  const text = fs.readFileSync(arena, 'utf8');
  const swapped = text.replace(/const TREASURY: address = @0x[0-9a-f]+;/, `const TREASURY: address = @${TREASURY.addr};`);
  if (swapped === text) throw new Error('could not swap TREASURY constant');
  fs.writeFileSync(arena, swapped);
  const out = execSync(`${SUI_BIN} move build --dump-bytecode-as-base64 --path ${dir}`, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
  });
  const json = out.slice(out.indexOf('{'));
  return JSON.parse(json);
}

// ---------------------------------------------------------------- main
async function main() {
  section('Setup — local chain, wallets, publish');
  const chain = await client.getChainIdentifier();
  ok(`local chain reachable (${chain})`);
  for (const w of [TREASURY, ALICE, BOB, CAROL, DAVE]) await fund(w);
  ok('5 wallets funded from faucet');

  const { modules, dependencies } = buildPackage();
  const pub = await mustRun(TREASURY, `publish package (${modules.length} modules)`, (tx) => {
    const [cap] = tx.publish({ modules, dependencies });
    tx.transferObjects([cap], TREASURY.addr);
  });
  const PKG = ((pub.objectChanges ?? []).find((o: any) => o.type === 'published') as any).packageId as string;
  const ADMIN = created(pub, '::character::AdminCap');
  const CHAR_REG = created(pub, '::character::CharacterRegistry');
  const WAGER_REG = created(pub, '::arena::OpenWagerRegistry');
  const t = (m: string, f: string) => `${PKG}::${m}::${f}`;

  // ------------------------------------------------------------ characters
  section('Characters');
  const chars: Record<string, string> = {};
  const builds: Record<string, [number, number, number, number]> = {
    ALICE: [8, 4, 4, 4], BOB: [4, 8, 4, 4], CAROL: [4, 4, 8, 4], DAVE: [4, 4, 4, 8],
  };
  for (const w of [ALICE, BOB, CAROL, DAVE]) {
    const [s, d, i, e] = builds[w.name];
    const r = await mustRun(w, `${w.name} creates character (STR ${s} DEX ${d} INT ${i} END ${e})`, (tx) => {
      tx.moveCall({ target: t('character', 'create_character'), arguments: [
        tx.pure.string(`${w.name[0]}${w.name.slice(1).toLowerCase()}`), tx.pure.u16(s), tx.pure.u16(d), tx.pure.u16(i), tx.pure.u16(e),
        tx.object(CHAR_REG), tx.object(CLOCK),
      ] });
    });
    chars[w.name] = created(r, '::character::Character');
  }
  await mustAbort(ALICE, 'second character for same wallet', 'character', 6, (tx) => {
    tx.moveCall({ target: t('character', 'create_character'), arguments: [
      tx.pure.string('Dup'), tx.pure.u16(5), tx.pure.u16(5), tx.pure.u16(5), tx.pure.u16(5), tx.object(CHAR_REG), tx.object(CLOCK),
    ] });
  });
  await mustAbort(BOB, 'character with wrong stat total (21)', 'character', 0, (tx) => {
    tx.moveCall({ target: t('character', 'create_character'), arguments: [
      tx.pure.string('Cheat'), tx.pure.u16(6), tx.pure.u16(5), tx.pure.u16(5), tx.pure.u16(5), tx.object(CHAR_REG), tx.object(CLOCK),
    ] });
  });

  // ------------------------------------------------------------ guilds
  section('Guilds — registry, create, join, roles, treasury, disband');
  const reg = await mustRun(TREASURY, 'TREASURY creates GuildRegistry (AdminCap)', (tx) => {
    tx.moveCall({ target: t('guild', 'create_guild_registry'), arguments: [tx.object(ADMIN), tx.object(CHAR_REG)] });
  });
  const GUILD_REG = created(reg, '::guild::GuildRegistry');
  await mustAbort(TREASURY, 'second GuildRegistry', 'guild', 0, (tx) => {
    tx.moveCall({ target: t('guild', 'create_guild_registry'), arguments: [tx.object(ADMIN), tx.object(CHAR_REG)] });
  });

  const createGuild = (w: Wallet, name: string, open: boolean, fee: bigint) => (tx: Transaction) => {
    const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(fee)]);
    tx.moveCall({ target: t('guild', 'create_guild'), arguments: [
      tx.object(GUILD_REG), tx.object(chars[w.name]), tx.pure.string(name), tx.pure.bool(open), c, tx.object(CLOCK),
    ] });
  };
  await mustAbort(ALICE, 'create guild paying 0.5 SUI (fee is 1 SUI)', 'guild', 3, createGuild(ALICE, 'Iron Wolves', false, SUI / 2n));
  await mustAbort(ALICE, 'create guild named "<script>"', 'guild', 4, createGuild(ALICE, '<script>', false, SUI));
  await mustAbort(BOB, 'create guild with ALICE\'s character', 'guild', 1, (tx) => {
    const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(SUI)]);
    tx.moveCall({ target: t('guild', 'create_guild'), arguments: [
      tx.object(GUILD_REG), tx.object(chars.ALICE), tx.pure.string('Thieves'), tx.pure.bool(true), c, tx.object(CLOCK),
    ] });
  });
  const g1 = await mustRun(ALICE, 'ALICE founds "Iron Wolves" (invite-only, 1 SUI)', createGuild(ALICE, 'Iron Wolves', false, SUI));
  const WOLVES = created(g1, '::guild::Guild');
  const tBal = await client.getBalance({ owner: TREASURY.addr });
  check(true, `TREASURY balance now ${Number(BigInt(tBal.totalBalance)) / 1e9} SUI (fee received)`);
  const feeEvt = (g1.balanceChanges ?? []).some((b: any) => b.owner?.AddressOwner === TREASURY.addr && BigInt(b.amount) === SUI);
  check(feeEvt, '1 SUI creation fee credited to TREASURY');
  await mustAbort(BOB, 'BOB founds "iron WOLVES" (case-insensitive duplicate)', 'guild', 5, createGuild(BOB, 'iron WOLVES', true, SUI));

  const gCall = (w: Wallet, fn: string, args: (tx: Transaction) => any[]) => (tx: Transaction) => {
    tx.moveCall({ target: t('guild', fn), arguments: args(tx) });
  };
  const join = (w: Wallet) => gCall(w, 'join_guild', (tx) => [tx.object(WOLVES), tx.object(GUILD_REG), tx.object(chars[w.name]), tx.object(CLOCK)]);

  await mustAbort(BOB, 'BOB joins invite-only guild without invite', 'guild', 10, join(BOB));
  await mustAbort(BOB, 'BOB (member) tries to invite CAROL', 'guild', 6, gCall(BOB, 'invite_member', (tx) => [tx.object(WOLVES), tx.pure.address(CAROL.addr)]));
  await mustRun(ALICE, 'ALICE invites BOB', gCall(ALICE, 'invite_member', (tx) => [tx.object(WOLVES), tx.pure.address(BOB.addr)]));
  await mustRun(BOB, 'BOB joins with invite', join(BOB));
  await mustAbort(CAROL, 'CAROL joins without invite', 'guild', 10, join(CAROL));
  await mustRun(ALICE, 'ALICE opens the guild to everyone', gCall(ALICE, 'set_open', (tx) => [tx.object(WOLVES), tx.pure.bool(true)]));
  await mustRun(CAROL, 'CAROL joins the open guild', join(CAROL));
  await mustRun(ALICE, 'ALICE sets guild description + emblem', gCall(ALICE, 'set_profile', (tx) => [
    tx.object(WOLVES), tx.pure.string('We hunt in packs.'), tx.pure.string('ipfs://emblem-wolves'),
  ]));
  let gf = await fields(WOLVES);
  check(Number(gf.member_count) === 3, `member_count = 3 (got ${gf.member_count})`);

  await mustRun(ALICE, 'ALICE promotes BOB to officer', gCall(ALICE, 'promote_to_officer', (tx) => [tx.object(WOLVES), tx.pure.address(BOB.addr)]));
  await mustAbort(BOB, 'officer BOB kicks leader ALICE', 'guild', 13, gCall(BOB, 'kick_member', (tx) => [tx.object(WOLVES), tx.object(GUILD_REG), tx.pure.address(ALICE.addr), tx.object(CLOCK)]));
  await mustRun(BOB, 'officer BOB kicks member CAROL', gCall(BOB, 'kick_member', (tx) => [tx.object(WOLVES), tx.object(GUILD_REG), tx.pure.address(CAROL.addr), tx.object(CLOCK)]));
  await mustRun(CAROL, 'CAROL re-joins (guild is open)', join(CAROL));

  const donate = (w: Wallet, amt: bigint) => (tx: Transaction) => {
    const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(amt)]);
    tx.moveCall({ target: t('guild', 'donate'), arguments: [tx.object(WOLVES), c] });
  };
  await mustAbort(DAVE, 'outsider DAVE donates', 'guild', 6, donate(DAVE, SUI));
  await mustRun(BOB, 'BOB donates 2 SUI to guild treasury', donate(BOB, 2n * SUI));
  await mustRun(CAROL, 'CAROL donates 1 SUI', donate(CAROL, SUI));
  await mustAbort(BOB, 'officer BOB withdraws', 'guild', 7, gCall(BOB, 'withdraw', (tx) => [tx.object(WOLVES), tx.pure.u64(SUI), tx.object(CLOCK)]));
  await mustAbort(ALICE, 'ALICE withdraws 4 SUI (only 3 in treasury)', 'guild', 15, gCall(ALICE, 'withdraw', (tx) => [tx.object(WOLVES), tx.pure.u64(4n * SUI), tx.object(CLOCK)]));
  const wd = await mustRun(ALICE, 'leader ALICE withdraws 1 SUI', gCall(ALICE, 'withdraw', (tx) => [tx.object(WOLVES), tx.pure.u64(SUI), tx.object(CLOCK)]));
  check(balanceDelta(wd, ALICE.addr) + gasOf(wd) === SUI, 'ALICE received exactly 1 SUI');
  gf = await fields(WOLVES);
  check(num(gf.treasury) === 2n * SUI, `guild treasury = 2 SUI (got ${Number(num(gf.treasury)) / 1e9})`);

  await mustAbort(ALICE, 'leader ALICE tries to leave', 'guild', 11, gCall(ALICE, 'leave_guild', (tx) => [tx.object(WOLVES), tx.object(GUILD_REG), tx.object(CLOCK)]));
  await mustRun(ALICE, 'ALICE hands leadership to BOB', gCall(ALICE, 'transfer_leadership', (tx) => [tx.object(WOLVES), tx.pure.address(BOB.addr)]));
  gf = await fields(WOLVES);
  check(gf.leader === BOB.addr, 'BOB is now leader');
  await mustRun(ALICE, 'ALICE (now officer) leaves', gCall(ALICE, 'leave_guild', (tx) => [tx.object(WOLVES), tx.object(GUILD_REG), tx.object(CLOCK)]));
  await mustAbort(BOB, 'BOB disbands with CAROL still inside', 'guild', 16, gCall(BOB, 'disband_guild', (tx) => [tx.object(WOLVES), tx.object(GUILD_REG), tx.object(CLOCK)]));
  await mustRun(CAROL, 'CAROL leaves', gCall(CAROL, 'leave_guild', (tx) => [tx.object(WOLVES), tx.object(GUILD_REG), tx.object(CLOCK)]));
  const dis = await mustRun(BOB, 'BOB disbands (last member) — treasury paid out', gCall(BOB, 'disband_guild', (tx) => [tx.object(WOLVES), tx.object(GUILD_REG), tx.object(CLOCK)]));
  check(balanceDelta(dis, BOB.addr) + gasOf(dis) === 2n * SUI, 'BOB received the remaining 2 SUI');
  const gone = await client.getObject({ id: WOLVES });
  check(!!gone.error, 'Guild object deleted from chain');
  await mustRun(DAVE, 'DAVE re-uses the freed name "Iron Wolves"', createGuild(DAVE, 'Iron Wolves', true, SUI));

  // ------------------------------------------------------------ wagers
  section('1v1 wagers — request/approve/settle, tie, decline, withdraw, exploit guards');
  const createWager = (w: Wallet, stake: bigint) => (tx: Transaction) => {
    const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(stake)]);
    tx.moveCall({ target: t('arena', 'create_wager'), arguments: [c, tx.object(chars[w.name]), tx.object(WAGER_REG), tx.object(CLOCK)] });
  };
  const request = (w: Wallet, wager: string, stake: bigint) => (tx: Transaction) => {
    const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(stake)]);
    tx.moveCall({ target: t('arena', 'request_accept_wager'), arguments: [tx.object(wager), c, tx.object(chars[w.name]), tx.object(WAGER_REG), tx.object(CLOCK)] });
  };
  const aCall = (fn: string, args: (tx: Transaction) => any[]) => (tx: Transaction) => {
    tx.moveCall({ target: t('arena', fn), arguments: args(tx) });
  };
  const STAKE = SUI / 2n;

  const w1r = await mustRun(ALICE, 'ALICE creates 0.5 SUI wager', createWager(ALICE, STAKE));
  const W1 = created(w1r, '::arena::WagerMatch');
  await mustAbort(ALICE, 'ALICE opens a second wager', 'arena', 11, createWager(ALICE, STAKE));
  await mustAbort(BOB, 'BOB requests with wrong stake', 'arena', 3, request(BOB, W1, STAKE + 1n));
  await mustRun(BOB, 'BOB requests to accept', request(BOB, W1, STAKE));
  await mustAbort(CAROL, 'CAROL requests while slot is taken', 'arena', 1, request(CAROL, W1, STAKE));
  await mustAbort(BOB, 'BOB approves his own challenge', 'arena', 15, aCall('approve_challenger', (tx) => [tx.object(W1), tx.object(CLOCK)]));
  await mustRun(ALICE, 'ALICE approves BOB → ACTIVE', aCall('approve_challenger', (tx) => [tx.object(W1), tx.object(CLOCK)]));
  await mustAbort(BOB, 'EXPLOIT GUARD: loser BOB force-splits via cancel_expired_wager', 'arena', 9,
    aCall('cancel_expired_wager', (tx) => [tx.object(W1), tx.object(WAGER_REG), tx.object(CLOCK)]));
  await mustAbort(BOB, 'EXPLOIT GUARD: BOB reclaims before 30 min', 'arena', 19,
    aCall('reclaim_stalled_wager', (tx) => [tx.object(W1), tx.object(WAGER_REG), tx.object(CLOCK)]));
  await mustAbort(ALICE, 'ALICE settles her own wager (not TREASURY)', 'arena', 8,
    aCall('settle_wager', (tx) => [tx.object(W1), tx.pure.address(ALICE.addr), tx.object(WAGER_REG), tx.object(CLOCK)]));
  await mustAbort(TREASURY, 'TREASURY settles to an outsider', 'arena', 5,
    aCall('settle_wager', (tx) => [tx.object(W1), tx.pure.address(DAVE.addr), tx.object(WAGER_REG), tx.object(CLOCK)]));
  const s1 = await mustRun(TREASURY, 'TREASURY settles: ALICE wins', aCall('settle_wager', (tx) => [tx.object(W1), tx.pure.address(ALICE.addr), tx.object(WAGER_REG), tx.object(CLOCK)]));
  check(balanceDelta(s1, ALICE.addr) === (2n * STAKE * 95n) / 100n, `ALICE paid 95% of 1 SUI pot (${Number(balanceDelta(s1, ALICE.addr)) / 1e9} SUI)`);
  check(balanceDelta(s1, TREASURY.addr) + gasOf(s1) === (2n * STAKE * 5n) / 100n, 'TREASURY took 5% fee (0.05 SUI)');
  await mustAbort(TREASURY, 'settle the same wager twice', 'arena', 2,
    aCall('settle_wager', (tx) => [tx.object(W1), tx.pure.address(ALICE.addr), tx.object(WAGER_REG), tx.object(CLOCK)]));

  const w2r = await mustRun(CAROL, 'CAROL creates wager #2', createWager(CAROL, STAKE));
  const W2 = created(w2r, '::arena::WagerMatch');
  await mustRun(DAVE, 'DAVE requests', request(DAVE, W2, STAKE));
  const dec = await mustRun(CAROL, 'CAROL declines DAVE (DAVE refunded)', aCall('decline_challenger', (tx) => [tx.object(W2)]));
  check(balanceDelta(dec, DAVE.addr) === STAKE, 'DAVE got his 0.5 SUI back');
  await mustRun(DAVE, 'DAVE requests again', request(DAVE, W2, STAKE));
  const wdr = await mustRun(DAVE, 'DAVE withdraws his own request', aCall('withdraw_challenge', (tx) => [tx.object(W2)]));
  check(balanceDelta(wdr, DAVE.addr) + gasOf(wdr) === STAKE, 'DAVE refunded on withdraw');

  // fight-locked challenger
  await mustRun(TREASURY, 'server fight-locks DAVE (mid-fight elsewhere)', (tx) => {
    tx.moveCall({ target: t('character', 'set_fight_lock'), arguments: [tx.object(ADMIN), tx.object(chars.DAVE), tx.pure.u64(Date.now() + 10 * 60_000), tx.object(CLOCK)] });
  });
  await mustAbort(DAVE, 'fight-locked DAVE requests a wager (v5.3 fix)', 'arena', 24, request(DAVE, W2, STAKE));
  await mustRun(TREASURY, 'server releases DAVE\'s fight-lock', (tx) => {
    tx.moveCall({ target: t('character', 'set_fight_lock'), arguments: [tx.object(ADMIN), tx.object(chars.DAVE), tx.pure.u64(0), tx.object(CLOCK)] });
  });
  await mustRun(DAVE, 'DAVE requests once unlocked', request(DAVE, W2, STAKE));
  await mustRun(CAROL, 'CAROL approves DAVE', aCall('approve_challenger', (tx) => [tx.object(W2), tx.object(CLOCK)]));
  const tie = await mustRun(TREASURY, 'TREASURY settles mutual KO as a tie', aCall('settle_tie', (tx) => [tx.object(W2), tx.object(WAGER_REG), tx.object(CLOCK)]));
  check(balanceDelta(tie, CAROL.addr) === STAKE && balanceDelta(tie, DAVE.addr) === STAKE, 'tie: both refunded 0.5 SUI, no fee');

  const w3r = await mustRun(BOB, 'BOB creates wager #3', createWager(BOB, STAKE));
  const W3 = created(w3r, '::arena::WagerMatch');
  await mustAbort(CAROL, 'CAROL cancels BOB\'s wager', 'arena', 4, aCall('cancel_wager', (tx) => [tx.object(W3), tx.object(WAGER_REG), tx.object(CLOCK)]));
  const cw = await mustRun(BOB, 'BOB cancels his unaccepted wager (refund)', aCall('cancel_wager', (tx) => [tx.object(W3), tx.object(WAGER_REG), tx.object(CLOCK)]));
  check(balanceDelta(cw, BOB.addr) + gasOf(cw) === STAKE, 'BOB refunded 0.5 SUI');
  await mustRun(BOB, 'BOB can open a new wager after cancelling', createWager(BOB, STAKE));

  // ------------------------------------------------------------ items
  section('Items — mint (budget rules), transfer, equip');
  const mint = (name: string, type: number, rarity: number, slotType: number, b: number[], minD: number, maxD: number, level = 3) => (tx: Transaction) => {
    const item = tx.moveCall({ target: t('item', 'mint_item_admin'), arguments: [
      tx.object(ADMIN), tx.pure.string(name), tx.pure.string(`ipfs://${name.toLowerCase().replace(/ /g, '-')}`),
      tx.pure.u8(type), tx.pure.u8(0), tx.pure.u8(level), tx.pure.u8(rarity), tx.pure.u8(slotType),
      ...b.map((v) => tx.pure.u16(v)), tx.pure.u16(minD), tx.pure.u16(maxD),
    ] });
    void item;
  };
  //                      STR DEX INT END HP ARM DEF ATK CRT CMUL EVA ACRT AEVA
  const Z = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const sword = [2, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0]; // + dmg 3-8 → budget 12/20
  await mustAbort(TREASURY, 'mint Common with 25 STR (budget 20)', 'item', 5, mint('Greedy Blade', 1, 1, 0, [25, ...Z.slice(1)], 1, 2));
  await mustAbort(TREASURY, 'v5.3 gate: weapon at level 2', 'item', 9, mint('Baby Sword', 1, 1, 0, sword, 3, 8, 2));
  await mustAbort(TREASURY, 'v5.3 gate: shield at level 1', 'item', 9, mint('Baby Shield', 2, 1, 1, Z, 0, 0, 1));
  await mustAbort(TREASURY, 'v5.3 gate: Legendary helmet at level 10', 'item', 8, mint('Early Crown', 3, 5, 0, [0, 0, 0, 0, 5, ...Z.slice(5)], 0, 0, 10));
  await mustAbort(TREASURY, 'v5.3 gate: Uncommon helmet at level 2', 'item', 8, mint('Early Cap', 3, 2, 0, [0, 0, 0, 0, 5, ...Z.slice(5)], 0, 0, 2));
  await mustRun(TREASURY, 'v5.3 gate: Common helmet at level 1 is allowed', mint('Leather Cap', 3, 1, 0, [0, 0, 0, 0, 5, ...Z.slice(5)], 0, 0, 1));
  await mustAbort(TREASURY, 'mint shield as mainhand', 'item', 6, mint('Wrong Shield', 2, 1, 0, Z, 0, 0));
  await mustFail(ALICE, 'player mints using TREASURY\'s AdminCap', mint('Stolen Blade', 1, 1, 0, sword, 3, 8));
  const m1 = await mustRun(TREASURY, 'mint Common "Iron Gladius" (STR+2 ATK+2 dmg 3-8)', mint('Iron Gladius', 1, 1, 0, sword, 3, 8));
  const SWORD = created(m1, '::item::Item');
  const m2 = await mustRun(TREASURY, 'mint Uncommon "Bronze Hoplon" shield (ARM+6 DEF+4 HP+12)', mint('Bronze Hoplon', 2, 2, 1, [0, 0, 0, 0, 12, 6, 4, 0, 0, 0, 0, 0, 0], 0, 0));
  const SHIELD = created(m2, '::item::Item');
  await mustRun(TREASURY, 'transfer both items to ALICE', (tx) => { tx.transferObjects([tx.object(SWORD), tx.object(SHIELD)], ALICE.addr); });
  await mustAbort(ALICE, 'level-1 ALICE equips a level-3 sword', 'equipment', 3, (tx) => {
    tx.moveCall({ target: t('equipment', 'equip_weapon'), arguments: [tx.object(chars.ALICE), tx.object(SWORD), tx.object(CLOCK)] });
  });
  await mustRun(TREASURY, 'server grants ALICE 300 XP (a won fight) → level 3', (tx) => {
    tx.moveCall({ target: t('character', 'update_after_fight'), arguments: [
      tx.object(ADMIN), tx.object(chars.ALICE), tx.pure.bool(true), tx.pure.u64(300), tx.pure.u16(1016), tx.object(CLOCK),
    ] });
  });
  check(Number((await fields(chars.ALICE)).level) === 3, 'ALICE is level 3 on chain');
  await mustFail(BOB, 'BOB equips ALICE\'s sword onto ALICE\'s character', (tx) => {
    tx.moveCall({ target: t('equipment', 'equip_weapon'), arguments: [tx.object(chars.ALICE), tx.object(SWORD), tx.object(CLOCK)] });
  });
  await mustRun(ALICE, 'ALICE equips sword + shield in one transaction', (tx) => {
    tx.moveCall({ target: t('equipment', 'equip_weapon'), arguments: [tx.object(chars.ALICE), tx.object(SWORD), tx.object(CLOCK)] });
    tx.moveCall({ target: t('equipment', 'equip_offhand'), arguments: [tx.object(chars.ALICE), tx.object(SHIELD), tx.object(CLOCK)] });
  });
  const dofs = await client.getDynamicFields({ parentId: chars.ALICE });
  const slotNames = dofs.data.map((d: any) => d.name?.value).filter(Boolean).sort();
  check(slotNames.includes('weapon') && slotNames.includes('offhand'), `ALICE's character holds items in slots: ${slotNames.join(', ')}`);

  // ------------------------------------------------------------ battles
  section('Battles — real server combat engine, on-chain stats + gear');
  const { createFighterState, resolveTurn, checkFightEnd, generateRandomAction, getOffhandType, judgeByHp } =
    require('../server/src/game/combat');
  const EMPTY = { weapon: null, offhand: null, helmet: null, chest: null, gloves: null, boots: null, belt: null,
    ring1: null, ring2: null, necklace: null, ring3: null, pants: null, bracelets: null };

  async function loadChar(name: string): Promise<any> {
    const f = await fields(chars[name]);
    const equipment: any = { ...EMPTY };
    for (const d of (await client.getDynamicFields({ parentId: chars[name] })).data as any[]) {
      const slot = d.name?.value as string;
      const o = await client.getObject({ id: d.objectId, options: { showContent: true } });
      const it = (o.data?.content as any)?.fields;
      if (!it || !slot) continue;
      const key = slot === 'ring_1' ? 'ring1' : slot === 'ring_2' ? 'ring2' : slot === 'ring_3' ? 'ring3' : slot;
      equipment[key] = {
        id: d.objectId, name: it.name, itemType: Number(it.item_type), slotType: Number(it.slot_type),
        minDamage: Number(it.min_damage), maxDamage: Number(it.max_damage),
        statBonuses: {
          strength: Number(it.strength_bonus), dexterity: Number(it.dexterity_bonus), intuition: Number(it.intuition_bonus),
          endurance: Number(it.endurance_bonus), hp: Number(it.hp_bonus), armor: Number(it.armor_bonus),
          defense: Number(it.defense_bonus), damage: Number(it.attack_bonus), critBonus: Number(it.crit_chance_bonus),
          critMultiplier: Number(it.crit_multiplier_bonus), evasion: Number(it.evasion_bonus),
          antiCrit: Number(it.anti_crit_bonus), antiEvasion: Number(it.anti_evasion_bonus),
        },
      };
    }
    return {
      id: chars[name], name: f.name, level: Number(f.level), walletAddress: f.owner, xp: Number(f.xp),
      stats: { strength: Number(f.strength), dexterity: Number(f.dexterity), intuition: Number(f.intuition), endurance: Number(f.endurance) },
      equipment, inventory: [], gold: 0, wins: 0, losses: 0, rating: 1000,
    };
  }

  function simulate(a: any, b: any, n: number, maxTurns = 60) {
    let aWins = 0, bWins = 0, draws = 0, timeLimited = 0, longest = 0, negHp = 0;
    for (let i = 0; i < n; i++) {
      const fa = createFighterState(a, b);
      const fb = createFighterState(b, a);
      let turn = 0; let end: any = { finished: false };
      while (!end.finished && turn < maxTurns) {
        turn++;
        resolveTurn(turn, fa, fb, generateRandomAction(getOffhandType(a.equipment)), generateRandomAction(getOffhandType(b.equipment)));
        if (fa.currentHp < 0 || fb.currentHp < 0) negHp++;
        end = checkFightEnd(fa, fb);
      }
      if (!end.finished) { timeLimited++; const v = judgeByHp(fa, fb); end = { winner: v.winner, draw: v.draw }; }
      longest = Math.max(longest, turn);
      if (end.draw) draws++; else if (end.winner === a.id) aWins++; else bWins++;
    }
    return { aWins, bWins, draws, timeLimited, longest, negHp };
  }

  const alice = await loadChar('ALICE');
  const bob = await loadChar('BOB');
  const carol = await loadChar('CAROL');
  const dave = await loadChar('DAVE');
  check(!!alice.equipment.weapon && !!alice.equipment.offhand, `ALICE loaded from chain with ${alice.equipment.weapon?.name} + ${alice.equipment.offhand?.name}`);
  const aStats = createFighterState(alice, bob).derivedStats;
  const bStats = createFighterState(bob, alice).derivedStats;
  console.log(`        ALICE (STR build, geared): HP ${aStats.maxHp}, attack ${aStats.attackPower}, armor ${aStats.armor}`);
  console.log(`        BOB   (DEX build, naked):  HP ${bStats.maxHp}, attack ${bStats.attackPower}, evasion ${bStats.evasionChance}%`);

  const N = 500;
  const matchups: [string, any, any][] = [
    ['ALICE (geared) vs BOB', alice, bob], ['BOB vs CAROL', bob, carol], ['CAROL vs DAVE', carol, dave], ['DAVE vs BOB', dave, bob],
  ];
  for (const [label, a, b] of matchups) {
    const r = simulate(a, b, N);
    console.log(`        ${label.padEnd(22)} → ${a.name} ${r.aWins} / ${b.name} ${r.bWins} / draw ${r.draws}  (longest ${r.longest} turns, time-limited ${r.timeLimited})`);
    check(r.aWins + r.bWins + r.draws === N, `${label}: all ${N} fights produced a result`);
    check(r.negHp === 0, `${label}: HP never went negative`);
  }
  const naked = { ...alice, equipment: { ...EMPTY } };
  const geared = simulate(alice, bob, N);
  const bare = simulate(naked, bob, N);
  console.log(`        gear impact: ALICE wins ${geared.aWins}/${N} geared vs ${bare.aWins}/${N} naked`);
  check(geared.aWins > bare.aWins, 'equipped items measurably improve win rate');

  // ------------------------------------------------------------ summary
  console.log(`\n${'='.repeat(64)}\nE2E localnet: ${passes}/${passes + failures} PASS, ${failures} FAIL`);
  if (failed.length) console.log(`Failed:\n - ${failed.join('\n - ')}`);
  console.log('='.repeat(64));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nE2E aborted:', e?.message ?? e);
  console.log(`\n${passes} PASS, ${failures + 1} FAIL (run aborted)`);
  process.exit(1);
});
