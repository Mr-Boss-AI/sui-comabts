/**
 * Offhand-style rules gauntlet (v5.3, 2026-09-27).
 *
 *   $ cd server && npx tsx ../scripts/qa-offhand-rules.ts
 *
 * Pins the v5.3 combat rules:
 *   - Dual-wield: 2 strikes (may hit the SAME zone twice) + 2-zone guard.
 *   - Dual-wield strikes land DUAL_WIELD_HIT_FACTOR of the damage, and the
 *     offhand weapon adds OFFHAND_WEAPON_DAMAGE_FACTOR of its average damage.
 *   - Two-hand weapon: landed damage × TWO_HAND_DAMAGE_MULT.
 *   - Shield: 1 strike + 3-zone guard line (unchanged).
 */
import { GAME_CONSTANTS } from '../server/src/config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const C = require('../server/src/game/combat');

let passes = 0, failures = 0;
function check(cond: boolean, label: string, detail = '') {
  if (cond) { passes++; console.log(`  \x1b[32mPASS\x1b[0m ${label}`); }
  else { failures++; console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? `\n        ${detail}` : ''}`); }
}

const EMPTY = { weapon: null, offhand: null, helmet: null, chest: null, gloves: null, boots: null, belt: null,
  ring1: null, ring2: null, necklace: null, ring3: null, pants: null, bracelets: null };
const sword = { statBonuses: {}, minDamage: 4, maxDamage: 8, itemType: 1, slotType: 0 };
const greatsword = { statBonuses: {}, minDamage: 8, maxDamage: 16, itemType: 1, slotType: 2 };
const shield = { statBonuses: {}, minDamage: 0, maxDamage: 0, itemType: 2, slotType: 1 };
const STATS = { strength: 10, dexterity: 10, intuition: 10, endurance: 10 };
const ch = (equipment: any) => ({ id: 'x', walletAddress: 'x', level: 10, stats: STATS, equipment: { ...EMPTY, ...equipment } });

console.log('\n[1] Zone counts');
const zc = (o: string) => C.getZoneCounts(o);
check(zc('dual_wield').attackSlots === 2 && zc('dual_wield').blockSlots === 2, 'dual-wield = 2 strikes + 2 guards');
check(zc('shield').attackSlots === 1 && zc('shield').blockSlots === 3, 'shield = 1 strike + 3 guards');
check(zc('none').attackSlots === 1 && zc('none').blockSlots === 2, 'no offhand = 1 strike + 2 guards');

console.log('\n[2] Action validation');
const v = (a: any, o: string) => C.validateTurnAction(a, o).valid;
check(v({ attackZones: ['head', 'head'], blockZones: ['chest', 'stomach'] }, 'dual_wield'), 'dual-wield: same zone twice + adjacent guard → valid');
check(v({ attackZones: ['head', 'legs'], blockZones: ['legs', 'head'] }, 'dual_wield'), 'dual-wield: legs+head guard (wraps) → valid');
check(!v({ attackZones: ['head', 'legs'], blockZones: ['chest'] }, 'dual_wield'), 'dual-wield: only 1 guard → rejected');
check(!v({ attackZones: ['head', 'legs'], blockZones: ['head', 'stomach'] }, 'dual_wield'), 'dual-wield: non-adjacent guard → rejected');
check(!v({ attackZones: ['head'], blockZones: ['chest', 'stomach'] }, 'dual_wield'), 'dual-wield: only 1 strike → rejected');
check(v({ attackZones: ['belt'], blockZones: ['head', 'chest', 'stomach'] }, 'shield'), 'shield: 3-zone line → valid');
for (let i = 0; i < 200; i++) {
  const a = C.generateRandomAction('dual_wield');
  if (!C.validateTurnAction(a, 'dual_wield').valid) { check(false, 'random dual-wield action is always valid', JSON.stringify(a)); break; }
  if (i === 199) check(true, 'random dual-wield action is always valid (200 samples)');
}

console.log('\n[3] Derived stats per style');
const none = C.deriveCombatStats(ch({ weapon: sword }));
const dual = C.deriveCombatStats(ch({ weapon: sword, offhand: { ...sword } }));
const two = C.deriveCombatStats(ch({ weapon: greatsword }));
const shd = C.deriveCombatStats(ch({ weapon: sword, offhand: shield }));
check(Math.abs(dual.attackPower - (none.attackPower + 6 * GAME_CONSTANTS.OFFHAND_WEAPON_DAMAGE_FACTOR)) < 1e-9,
  `dual attack power = main + ${GAME_CONSTANTS.OFFHAND_WEAPON_DAMAGE_FACTOR} × offhand avg (${none.attackPower} → ${dual.attackPower})`);
check(dual.damageMult === GAME_CONSTANTS.DUAL_WIELD_HIT_FACTOR, `dual damageMult = ${GAME_CONSTANTS.DUAL_WIELD_HIT_FACTOR}`);
check(two.damageMult === GAME_CONSTANTS.TWO_HAND_DAMAGE_MULT, `two-hand damageMult = ${GAME_CONSTANTS.TWO_HAND_DAMAGE_MULT}`);
check(none.damageMult === 1 && shd.damageMult === 1, 'shield / no-offhand damageMult = 1');
check(shd.blockLeak === GAME_CONSTANTS.SHIELD_BLOCK_LEAK && none.blockLeak === 0, `shield blockLeak = ${GAME_CONSTANTS.SHIELD_BLOCK_LEAK}`);

console.log('\n[4] Double strike on one zone');
const mk = (c: any) => C.createFighterState(c, c);
let bothBlocked = true, bothLand = true;
for (let i = 0; i < 300; i++) {
  const a = mk(ch({ weapon: sword, offhand: { ...sword } })); const b = mk(ch({ weapon: sword }));
  const r = C.resolveTurn(1, a, b, { attackZones: ['head', 'head'], blockZones: ['chest', 'stomach'] }, { attackZones: ['legs'], blockZones: ['head', 'chest'] });
  const hits = r.playerB.hits;
  if (hits.length !== 2 || hits.some((h: any) => !h.blocked)) bothBlocked = false;
  const a2 = mk(ch({ weapon: sword, offhand: { ...sword } })); const b2 = mk(ch({ weapon: sword }));
  const r2 = C.resolveTurn(1, a2, b2, { attackZones: ['legs', 'legs'], blockZones: ['chest', 'stomach'] }, { attackZones: ['legs'], blockZones: ['head', 'chest'] });
  if (r2.playerB.hits.length !== 2 || r2.playerB.hits.some((h: any) => h.blocked)) bothLand = false;
}
check(bothBlocked, 'both strikes into a guarded zone are blocked (the risk)');
check(bothLand, 'both strikes into an open zone land (the reward)');

console.log('\n[5] Crit through block (v5.3)');
{
  const mage = { id: 'm', walletAddress: 'm', level: 10, stats: { strength: 5, dexterity: 5, intuition: 40, endurance: 5 }, equipment: { ...EMPTY, weapon: sword } };
  const tank = ch({ weapon: sword });
  let pierced = 0, plainBlocked = 0, leakedWithoutCrit = 0, total = 2000;
  const ratios: number[] = [];
  for (let i = 0; i < total; i++) {
    const a = C.createFighterState(mage, tank); const b = C.createFighterState(tank, mage);
    const r = C.resolveTurn(1, a, b, { attackZones: ['head'], blockZones: ['chest', 'stomach'] }, { attackZones: ['legs'], blockZones: ['head', 'chest'] });
    const h = r.playerB.hits[0];
    if (!h.blocked) continue;
    if (h.crit && h.damage > 0) { pierced++; ratios.push(h.damage / (a.derivedStats.attackPower * a.derivedStats.critMultiplier)); }
    else { plainBlocked++; if (h.damage > 0) leakedWithoutCrit++; }
  }
  const rate = pierced / total * 100;
  const cc = C.createFighterState(mage, tank).derivedStats.critChance;
  check(Math.abs(rate - cc) < 3, `blocked strikes crit through at ≈ crit chance (${rate.toFixed(1)}% vs ${cc}%)`);
  const maxRatio = Math.max(...ratios), minRatio = Math.min(...ratios);
  const P = GAME_CONSTANTS.CRIT_BLOCK_PIERCE;
  check(minRatio >= P * 0.8 - 1e-6 && maxRatio <= P * 1.2 + 1e-6, `pierce damage = ${P * 100}% of crit damage (±20% roll): ${(minRatio * 100).toFixed(1)}–${(maxRatio * 100).toFixed(1)}%`);
  check(leakedWithoutCrit === 0 && plainBlocked > 0, 'non-crit blocked strikes deal 0 (no shield leak)');
}

console.log(`\n${'='.repeat(60)}\noffhand-rules gauntlet: ${passes}/${passes + failures} PASS, ${failures} FAIL\n${'='.repeat(60)}`);
process.exit(failures ? 1 : 0);
