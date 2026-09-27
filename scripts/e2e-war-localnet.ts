/**
 * Guild-war runner end-to-end against a LOCAL Sui network (v5.3).
 *
 * Needs a localnet with a v5.3 package whose arena TREASURY is a local key:
 *   $ sui start --with-faucet --force-regenesis
 *   $ DEPLOY_RECORD=/path/deploy-local.json TREASURY_KEY=suiprivkey1… \
 *       npx tsx ../scripts/e2e-war-localnet.ts          (from server/)
 *
 * Two guilds, two fighters each, one 2v2 war. The script plays the part of
 * the players (declare / accept / sign up) and drives the real server war
 * runner (ws/war-room.ts): start_war → battle → settle_war. One fighter is a
 * fake connected WS client that answers every exchange; the rest are offline
 * and auto-act. Takes ~6 min (5-min minimum start delay).
 */
import * as fs from 'fs';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

const RPC = process.env.LOCALNET_RPC ?? 'http://127.0.0.1:9000';
const FAUCET = process.env.LOCALNET_FAUCET ?? 'http://127.0.0.1:9123/v2/gas';
const CLOCK = '0x6';
const SUI = 1_000_000_000n;
const STAKE = SUI / 10n;

const rec = JSON.parse(fs.readFileSync(process.env.DEPLOY_RECORD ?? '', 'utf8'));
const treasuryKey = process.env.TREASURY_KEY ?? '';
const treasury = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(treasuryKey).secretKey);

// The war runner reads CONFIG at import time — point it at localnet first.
Object.assign(process.env, {
  SUI_RPC_URL: RPC,
  SUI_PACKAGE_ID: rec.packageId,
  ADMIN_CAP_ID: rec.adminCap,
  CHARACTER_REGISTRY_ID: rec.characterRegistry,
  WAR_REGISTRY_ID: rec.warRegistry,
  GUILD_REGISTRY_ID: rec.guildRegistry,
  PLATFORM_TREASURY: treasury.toSuiAddress(),
  SUI_TREASURY_PRIVATE_KEY: treasuryKey,
  WAR_POLL_MS: '3000',
});

const client = new SuiJsonRpcClient({ url: RPC, network: 'localnet' } as any);
const t = (m: string, f: string) => `${rec.packageId}::${m}::${f}`;

let passes = 0, failures = 0;
function check(cond: boolean, label: string, detail = '') {
  if (cond) { passes++; console.log(`  \x1b[32mPASS\x1b[0m ${label}`); }
  else { failures++; console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? `\n        ${detail}` : ''}`); }
}

type W = { name: string; kp: Ed25519Keypair; addr: string };
const mk = (name: string): W => { const kp = new Ed25519Keypair(); return { name, kp, addr: kp.getPublicKey().toSuiAddress() }; };
async function fund(w: W) {
  await fetch(FAUCET, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ FixedAmountRequest: { recipient: w.addr } }) });
  for (let i = 0; i < 40; i++) {
    if (BigInt((await client.getBalance({ owner: w.addr })).totalBalance) > 0n) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`faucet never funded ${w.name}`);
}
async function run(w: W, build: (tx: Transaction) => void) {
  const tx = new Transaction(); build(tx);
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer: w.kp, options: { showEffects: true, showObjectChanges: true } });
  await client.waitForTransaction({ digest: r.digest });
  if (r.effects?.status.status !== 'success') throw new Error(`${w.name}: ${r.effects?.status.error}`);
  return r;
}
const created = (r: any, suffix: string) => (r.objectChanges as any[]).find((o) => o.type === 'created' && o.objectType.endsWith(suffix)).objectId as string;
const fields = async (id: string) => ((await client.getObject({ id, options: { showContent: true } })).data?.content as any).fields;
const bal = async (a: string) => BigInt((await client.getBalance({ owner: a })).totalBalance);

(async () => {
  const [A1, A2, B1, B2] = ['WOLF1', 'WOLF2', 'CROW1', 'CROW2'].map(mk);
  const all = [A1, A2, B1, B2];
  console.log('\n[setup] 4 players, 2 guilds, one 2v2 war');
  await Promise.all(all.map(fund));
  const chars: Record<string, string> = {};
  for (const w of all) {
    const r = await run(w, (tx) => tx.moveCall({ target: t('character', 'create_character'), arguments: [
      tx.pure.string(w.name), tx.pure.u16(5), tx.pure.u16(5), tx.pure.u16(5), tx.pure.u16(5), tx.object(rec.characterRegistry), tx.object(CLOCK)] }));
    chars[w.name] = created(r, '::character::Character');
  }
  const found = async (w: W, name: string) => created(await run(w, (tx) => {
    const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(SUI)]);
    tx.moveCall({ target: t('guild', 'create_guild'), arguments: [tx.object(rec.guildRegistry), tx.object(chars[w.name]), tx.pure.string(name), tx.pure.bool(true), c, tx.object(CLOCK)] });
  }), '::guild::Guild');
  const suffix = Math.random().toString(36).slice(2, 7);
  const WOLVES = await found(A1, `Wolves ${suffix}`);
  const CROWS = await found(B1, `Crows ${suffix}`);
  await run(A2, (tx) => tx.moveCall({ target: t('guild', 'join_guild'), arguments: [tx.object(WOLVES), tx.object(rec.guildRegistry), tx.object(chars.WOLF2), tx.object(CLOCK)] }));
  await run(B2, (tx) => tx.moveCall({ target: t('guild', 'join_guild'), arguments: [tx.object(CROWS), tx.object(rec.guildRegistry), tx.object(chars.CROW2), tx.object(CLOCK)] }));

  const wr = await run(A1, (tx) => tx.moveCall({ target: t('guild_war', 'declare_war'), arguments: [
    tx.object(WOLVES), tx.object(CROWS), tx.object(chars.WOLF1), tx.pure.u64(2), tx.pure.u64(STAKE), tx.pure.u8(0), tx.pure.u64(300_000), tx.object(CLOCK)] }));
  const WAR = created(wr, '::guild_war::GuildWar');
  await run(B1, (tx) => tx.moveCall({ target: t('guild_war', 'accept_war'), arguments: [tx.object(WAR), tx.object(CROWS), tx.object(CLOCK)] }));
  for (const [w, g] of [[A1, WOLVES], [A2, WOLVES], [B1, CROWS], [B2, CROWS]] as const) {
    await run(w, (tx) => {
      const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(STAKE)]);
      tx.moveCall({ target: t('guild_war', 'join_war'), arguments: [tx.object(WAR), tx.object(rec.warRegistry), tx.object(g), tx.object(chars[w.name]), c, tx.object(CLOCK)] });
    });
  }
  const w0 = await fields(WAR);
  check(Number(w0.status) === 1 && w0.side_a.length === 2 && w0.side_b.length === 2, 'war ACCEPTED with 2 v 2 signed up');
  const before = Object.fromEntries(await Promise.all(all.map(async (w) => [w.name, await bal(w.addr)] as const)));

  // ---- the server war runner + one "online" fighter (WOLF1)
  const room = await import('../server/src/ws/war-room');
  const states: any[] = [];
  const sock: any = {
    OPEN: 1, readyState: 1,
    send(raw: string) {
      const m = JSON.parse(raw);
      states.push(m);
      if (m.type === 'war_state' && m.exchange && !m.exchange.chosen && !m.result) {
        setTimeout(() => room.dispatchWarMessage(fake, { type: 'war_action', warId: m.warId, attackZones: ['head'], blockZones: ['chest', 'stomach'] }), 50);
      }
    },
  };
  const fake: any = { id: 'fake', socket: sock, walletAddress: A1.addr, authenticated: true, lastChatTime: 0 };
  room.setWarClientsRef(new Map([['fake', fake]]));
  room.startWarRoom();

  const startAt = Number(w0.start_at);
  console.log(`\n[wait] war starts in ${Math.max(0, Math.round((startAt - Date.now()) / 1000))} s; battle follows`);
  let war: any = w0;
  const deadline = Date.now() + 25 * 60_000;
  let sawActive = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    war = await fields(WAR);
    if (Number(war.status) === 2 && !sawActive) { sawActive = true; console.log('  … war ACTIVE on chain, battle running'); }
    if (Number(war.status) >= 3) break;
  }
  room.stopWarRoom();

  console.log('\n[result]');
  check(sawActive || Number(war.status) === 3, 'server called start_war (ACTIVE seen)');
  check(Number(war.status) === 3, `server called settle_war (status ${war.status})`);
  const ws = states.filter((m) => m.type === 'war_state');
  check(ws.length > 0 && ws.some((m) => m.mySide === 'A'), `online fighter received war_state (${ws.length} pushes)`);
  const actedOn = ws.filter((m) => m.exchange).length;
  check(actedOn > 0, `online fighter was offered exchanges (${actedOn})`);
  const last = ws[ws.length - 1];
  check(!!last?.result, `final push carries the result (${last?.result})`);
  check(last?.settled === true && typeof last?.digest === 'string', 'final push is marked settled with a digest');
  const winner = Number(war.winner);
  const winners = winner === 1 ? [A1, A2] : winner === 2 ? [B1, B2] : [];
  const losers = winner === 1 ? [B1, B2] : winner === 2 ? [A1, A2] : [];
  for (const w of winners) {
    const d = (await bal(w.addr)) - before[w.name];
    check(d > STAKE / 2n, `${w.name} (winner) paid out +${Number(d) / 1e9} SUI`);
  }
  for (const w of losers) check((await bal(w.addr)) === before[w.name], `${w.name} (loser) stake gone, no refund`);
  if (winner === 3) for (const w of all) check((await bal(w.addr)) - before[w.name] === STAKE, `${w.name} refunded on draw`);
  const [ga, gb] = [await fields(WOLVES), await fields(CROWS)];
  check(Number(ga.wins) + Number(ga.losses) + Number(ga.draws) === 1 && Number(gb.wins) + Number(gb.losses) + Number(gb.draws) === 1, 'both guilds recorded the war');
  check(Number(ga.rating) !== 1000 || winner === 3, `guild ratings moved (Wolves ${ga.rating}, Crows ${gb.rating})`);
  const wreg = await fields(rec.warRegistry);
  const regTable = wreg.fighters.fields.id.id;
  const still = await client.getDynamicFieldObject({ parentId: regTable, name: { type: 'address', value: A1.addr } }).catch(() => null);
  check(!still?.data, 'fighters released from WarRegistry');

  console.log(`\n${'='.repeat(60)}\nwar e2e: ${passes}/${passes + failures} PASS, ${failures} FAIL\n${'='.repeat(60)}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
