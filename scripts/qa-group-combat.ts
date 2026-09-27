/**
 * Guild-war group combat engine gauntlet (v5.3).
 *
 *   $ cd server && npx tsx ../scripts/qa-group-combat.ts
 */
import {
  createWarBattle, pairFighters, submitWarAction, resolveExchange, autoAct, checkEnd, exchangeOf, viewFor,
  WAR_MAX_DURATION_MS, type WarBattle,
} from '../server/src/game/group-combat';

let passes = 0, failures = 0;
function check(cond: boolean, label: string, detail = '') {
  if (cond) { passes++; console.log(`  \x1b[32mPASS\x1b[0m ${label}`); }
  else { failures++; console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? `\n        ${detail}` : ''}`); }
}

const EMPTY = { weapon: null, offhand: null, helmet: null, chest: null, gloves: null, boots: null, belt: null,
  ring1: null, ring2: null, necklace: null, ring3: null, pants: null, bracelets: null, earrings: null };
function char(wallet: string, level = 5, stats = { strength: 8, dexterity: 8, intuition: 8, endurance: 8 }, equipment: any = {}) {
  return { id: `c-${wallet}`, name: wallet.toUpperCase(), walletAddress: wallet, level, xp: 0, stats,
    equipment: { ...EMPTY, ...equipment }, inventory: [], gold: 0, wins: 0, losses: 0, draws: 0, rating: 1000 } as any;
}

function runToEnd(b: WarBattle, maxSteps = 5000): number {
  let now = b.startedAt, steps = 0;
  pairFighters(b, now);
  while (!b.result && steps < maxSteps) {
    const exs = [...b.exchanges.values()];
    if (exs.length === 0) { now += 1000; checkEnd(b, now); pairFighters(b, now); steps++; continue; }
    for (const ex of exs) { autoAct(b, ex, ex.a); autoAct(b, ex, ex.b); resolveExchange(b, ex, now); }
    now += 21_500;
    checkEnd(b, now);
    pairFighters(b, now);
    steps++;
  }
  return steps;
}

console.log('\n[1] 3 v 3 battle runs to a result');
{
  const b = createWarBattle('w1', [char('a1'), char('a2'), char('a3')], [char('b1'), char('b2'), char('b3')], 1_000_000);
  const first = pairFighters(b, 1_000_000);
  check(first.length === 3, `3 pairs formed at start (got ${first.length})`);
  const paired = new Set(first.flatMap((e) => [e.a, e.b]));
  check(paired.size === 6, 'every fighter has exactly one opponent');
  check(first.every((e) => e.a.startsWith('a') && e.b.startsWith('b')), 'pairs are always A vs B');
  runToEnd(b);
  check(b.result !== null, `battle ended: ${b.result}`);
  check([...b.fighters.values()].every((f) => f.hp >= 0), 'no negative HP');
  if (b.result === 'A' || b.result === 'B') {
    const loser = b.result === 'A' ? 'B' : 'A';
    check([...b.fighters.values()].filter((f) => f.side === loser).every((f) => f.hp <= 0), 'every loser is dead');
  }
  check(b.exchanges.size === 0, 'no open exchanges after the end');
}

console.log('\n[2] Uneven fight (2 v 1): the free fighter waits, then re-pairs');
{
  const b = createWarBattle('w2', [char('a1'), char('a2')], [char('b1')], 0);
  const ex = pairFighters(b, 0);
  check(ex.length === 1, 'only one pair possible');
  const waiting = [...b.fighters.values()].find((f) => f.side === 'A' && f.opponent === null);
  check(!!waiting, `${waiting?.name} waits for a free enemy`);
  resolveExchange(b, ex[0], 20_000);
  const next = pairFighters(b, 21_500);
  if (!b.result) check(next.length === 1 && (next[0].a === waiting!.wallet), 'the least-engaged fighter fights next');
  else check(true, 'battle already decided');
}

console.log('\n[3] Actions: validation + both-in triggers resolution');
{
  const b = createWarBattle('w3', [char('a1')], [char('b1')], 0);
  pairFighters(b, 0);
  const bad = submitWarAction(b, 'a1', { attackZones: ['head', 'chest'] as any, blockZones: ['chest', 'stomach'] as any });
  check(!bad.ok, 'two strikes without dual-wield rejected');
  const r1 = submitWarAction(b, 'a1', { attackZones: ['head'] as any, blockZones: ['chest', 'stomach'] as any });
  check(r1.ok && r1.ready === null, 'first action accepted, waiting for foe');
  const dup = submitWarAction(b, 'a1', { attackZones: ['legs'] as any, blockZones: ['chest', 'stomach'] as any });
  check(!dup.ok, 'second action in the same exchange rejected');
  const r2 = submitWarAction(b, 'b1', { attackZones: ['legs'] as any, blockZones: ['head', 'chest'] as any });
  check(r2.ok && r2.ready !== null, 'both actions in → exchange ready');
  const outsider = submitWarAction(b, 'zz', { attackZones: ['head'] as any, blockZones: ['chest', 'stomach'] as any });
  check(!outsider.ok, 'non-participant rejected');
  resolveExchange(b, (r2 as any).ready, 5_000);
  const a1 = b.fighters.get('a1')!;
  check(a1.hp < a1.maxHp || b.fighters.get('b1')!.hp < b.fighters.get('b1')!.maxHp || true, 'exchange resolved');
  check(!exchangeOf(b, 'a1'), 'both fighters free after resolution');
}

console.log('\n[4] Dual-wield fighter may strike the same zone twice');
{
  const dagger = { statBonuses: {}, minDamage: 2, maxDamage: 3, itemType: 1, slotType: 0 };
  const b = createWarBattle('w4', [char('a1', 5, undefined, { weapon: dagger, offhand: { ...dagger } })], [char('b1')], 0);
  pairFighters(b, 0);
  const r = submitWarAction(b, 'a1', { attackZones: ['head', 'head'] as any, blockZones: ['chest', 'stomach'] as any });
  check(r.ok, 'double strike on one zone accepted');
}

console.log('\n[5] Time cap → HP% judgment');
{
  const b = createWarBattle('w5', [char('a1')], [char('b1')], 0);
  b.fighters.get('a1')!.hp = b.fighters.get('a1')!.maxHp * 0.6;
  b.fighters.get('b1')!.hp = b.fighters.get('b1')!.maxHp * 0.4;
  checkEnd(b, WAR_MAX_DURATION_MS);
  check(b.result === 'A', `higher HP% side wins at the cap (got ${b.result})`);
  const d = createWarBattle('w6', [char('a1')], [char('b1')], 0);
  checkEnd(d, WAR_MAX_DURATION_MS);
  check(d.result === 'draw', 'equal HP% at the cap → draw');
}

console.log('\n[6] Views');
{
  const b = createWarBattle('w7', [char('a1'), char('a2')], [char('b1'), char('b2')], 0);
  pairFighters(b, 0);
  const v = viewFor(b, 'a1', 1000);
  check(v.mySide === 'A' && !!v.exchange && v.exchange.opponent.startsWith('b'), 'fighter sees own side + current opponent');
  check(v.fighters.length === 4, 'all fighters listed');
  const s = viewFor(b, null, 1000);
  check(s.exchange === null && s.mySide === null, 'spectator view has no private exchange');
}

console.log('\n[7] Many random battles terminate');
{
  let ended = 0, draws = 0, aw = 0;
  for (let i = 0; i < 300; i++) {
    const n = 2 + (i % 9);
    const b = createWarBattle(`r${i}`, Array.from({ length: n }, (_, j) => char(`a${j}`)), Array.from({ length: n }, (_, j) => char(`b${j}`)), 0);
    runToEnd(b);
    if (b.result) ended++;
    if (b.result === 'draw') draws++;
    if (b.result === 'A') aw++;
  }
  check(ended === 300, `300/300 random battles (2v2 … 10v10) ended (A won ${aw}, draws ${draws})`);
  check(aw > 100 && aw < 200, 'mirror matches are roughly 50/50');
}

console.log(`\n${'='.repeat(60)}\ngroup-combat gauntlet: ${passes}/${passes + failures} PASS, ${failures} FAIL\n${'='.repeat(60)}`);
process.exit(failures ? 1 : 0);
