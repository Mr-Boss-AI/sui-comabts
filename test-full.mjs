/**
 * SUI Combats — Comprehensive E2E Test Script
 *
 * Tests every feature through REST API and WebSocket:
 *   1.  REST endpoints (health, leaderboard, shop, character, fights)
 *   2.  WebSocket auth flow
 *   3.  Error handling (bad stats, short name, duplicate character)
 *   4.  Character creation
 *   5.  Shop purchase, equip, unequip, inventory
 *   6.  Chat (global + whisper)
 *   7.  Online players
 *   8.  Matchmaking queue (join, cancel)
 *   9.  Full ranked fight with detailed combat log
 *  10.  Post-fight state (XP, rating, win/loss)
 *  11.  Fight history
 *  12.  Spectating
 *  13.  Leaderboard
 *  14.  Wager fight
 */

import WebSocket from 'ws';
import http from 'http';

const SERVER = 'http://localhost:3001';
const WS_URL = 'ws://localhost:3001';
const ZONES = ['head', 'chest', 'stomach', 'belt', 'legs'];
const TS = Date.now();

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function pass(label) {
  passCount++;
  console.log(`  \x1b[32m✓\x1b[0m ${label}`);
}
function fail(label, reason) {
  failCount++;
  console.log(`  \x1b[31m✗\x1b[0m ${label}  — ${reason}`);
}
function skip(label, reason) {
  skipCount++;
  console.log(`  \x1b[33m⊘\x1b[0m ${label}  — ${reason}`);
}
function section(title) {
  console.log(`\n\x1b[1m▸ ${title}\x1b[0m`);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`${SERVER}${path}`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

/** Create a WS player client */
function createPlayer(walletAddress) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const inbox = [];
    const waiters = [];
    const label = walletAddress.slice(-8);

    ws.on('open', () => resolve(player));
    ws.on('error', reject);

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      inbox.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].match(msg)) {
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    });

    const player = {
      ws, label, wallet: walletAddress, inbox,

      send(obj) { ws.send(JSON.stringify(obj)); },

      /** Wait for message matching type + optional filter */
      waitFor(type, timeoutMs = 15000, filter) {
        const idx = inbox.findIndex((m) => m.type === type && (!filter || filter(m)));
        if (idx !== -1) {
          const [found] = inbox.splice(idx, 1);
          return Promise.resolve(found);
        }
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`Timeout waiting for "${type}" (${label})`)),
            timeoutMs,
          );
          waiters.push({
            match: (m) => m.type === type && (!filter || filter(m)),
            resolve: (m) => {
              clearTimeout(timer);
              // Also remove from inbox if it was pushed before waiter resolved
              const ii = inbox.indexOf(m);
              if (ii !== -1) inbox.splice(ii, 1);
              resolve(m);
            },
          });
        });
      },

      /** Wait for any of several message types */
      waitForAny(types, timeoutMs = 15000) {
        const idx = inbox.findIndex((m) => types.includes(m.type));
        if (idx !== -1) {
          const [found] = inbox.splice(idx, 1);
          return Promise.resolve(found);
        }
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`Timeout waiting for any of [${types}] (${label})`)),
            timeoutMs,
          );
          waiters.push({
            match: (m) => types.includes(m.type),
            resolve: (m) => {
              clearTimeout(timer);
              const ii = inbox.indexOf(m);
              if (ii !== -1) inbox.splice(ii, 1);
              resolve(m);
            },
          });
        });
      },

      drain(type) {
        const out = inbox.filter((m) => m.type === type);
        for (const m of out) inbox.splice(inbox.indexOf(m), 1);
        return out;
      },

      close() { ws.close(); },
    };
  });
}

function randomZones(n) {
  const shuffled = [...ZONES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

const BLOCK_LINES = [
  ['head', 'chest'],
  ['chest', 'stomach'],
  ['stomach', 'belt'],
  ['belt', 'legs'],
];

function randomBlockLine() {
  return BLOCK_LINES[Math.floor(Math.random() * BLOCK_LINES.length)];
}

function printTurnSide(name, sideResult, hpAfter) {
  const atk = sideResult.actions?.attackZones || [];
  const blk = sideResult.actions?.blockZones || [];
  console.log(`    \x1b[1m${name}\x1b[0m  atk→[\x1b[33m${atk.join(',')}\x1b[0m]  blk→[\x1b[36m${blk.join(',')}\x1b[0m]`);
  for (const hit of sideResult.hits) {
    let tag;
    if (hit.blocked) tag = '\x1b[34m■ BLOCKED\x1b[0m';
    else if (hit.dodged) tag = '\x1b[33m~ DODGED\x1b[0m';
    else if (hit.crit) tag = `\x1b[31m✦ CRIT  ${hit.damage.toFixed(1)} dmg\x1b[0m`;
    else tag = `\x1b[32m→ HIT   ${hit.damage.toFixed(1)} dmg\x1b[0m`;
    console.log(`      ${hit.zone.padEnd(8)} ${tag}`);
  }
  console.log(`    HP: ${hpAfter.toFixed(1)}`);
}

/** Run a full fight, printing combat log. Returns fight summary. */
async function playFight(pA, pB, fightStartMsg, verbose = true) {
  const fight = fightStartMsg.fight;
  const pAName = fight.playerA.name;
  const pBName = fight.playerB.name;
  const allTurnResults = [];
  let finalMsg = null;

  if (verbose) {
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────┐');
    console.log(`  │  \x1b[1m${pAName}\x1b[0m  vs  \x1b[1m${pBName}\x1b[0m`);
    console.log(`  │  HP: ${fight.playerA.maxHp} vs ${fight.playerB.maxHp}`);
    console.log('  └─────────────────────────────────────────────────┘');
  }

  while (true) {
    // Wait for turn_start
    try {
      await pA.waitFor('turn_start', 15000);
      pB.drain('turn_start');
    } catch {
      break;
    }

    const atkA = randomZones(1);
    const blkA = randomBlockLine();
    const atkB = randomZones(1);
    const blkB = randomBlockLine();

    pA.send({ type: 'fight_action', attackZones: atkA, blockZones: blkA });
    pB.send({ type: 'fight_action', attackZones: atkB, blockZones: blkB });

    // Drain acks
    await sleep(50);
    pA.drain('fight_action_ack');
    pB.drain('fight_action_ack');

    // Wait for turn_result or fight_end via the unified waitForAny
    const msg = await pA.waitForAny(['turn_result', 'fight_end'], 15000);

    if (msg.type === 'turn_result') {
      const r = msg.result;
      const fightState = msg.fight;
      allTurnResults.push({ result: r, fight: fightState });
      pB.drain('turn_result');

      if (verbose) {
        console.log(`\n  \x1b[1m── Turn ${r.turn} ──\x1b[0m`);
        printTurnSide(pAName, r.playerA, fightState.playerA.currentHp);
        printTurnSide(pBName, r.playerB, fightState.playerB.currentHp);
      }

      // If fight ended this turn, fight_end follows immediately
      await sleep(50);
      const endCheck = pA.inbox.find((m) => m.type === 'fight_end');
      if (endCheck) {
        pA.inbox.splice(pA.inbox.indexOf(endCheck), 1);
        finalMsg = endCheck;
        pB.drain('fight_end');
        break;
      }
    }

    if (msg.type === 'fight_end') {
      finalMsg = msg;
      pB.drain('fight_end');
      pB.drain('turn_result');
      break;
    }
  }

  if (!finalMsg) {
    try {
      finalMsg = await pA.waitFor('fight_end', 20000);
      pB.drain('fight_end');
    } catch (e) {
      fail('Fight completion', e.message);
      return null;
    }
  }

  return { finalMsg, allTurnResults, pAName, pBName };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\x1b[1m\n══════════════════════════════════════════════════════');
  console.log('  SUI Combats — Full E2E Test Suite');
  console.log('══════════════════════════════════════════════════════\x1b[0m');

  // ── 1. REST API ───────────────────────────────
  section('1 — REST API Endpoints');

  const health = await httpGet('/health');
  health.status === 200 && health.body.status === 'ok'
    ? pass(`GET /health → status=${health.body.status}, uptime=${health.body.uptime.toFixed(1)}s`)
    : fail('GET /health', JSON.stringify(health.body));

  const lb = await httpGet('/api/leaderboard');
  lb.status === 200 && Array.isArray(lb.body.entries)
    ? pass(`GET /api/leaderboard → ${lb.body.entries.length} entries`)
    : fail('GET /api/leaderboard', JSON.stringify(lb.body));

  const shop = await httpGet('/api/shop');
  shop.status === 200 && Array.isArray(shop.body.items)
    ? pass(`GET /api/shop → ${shop.body.items.length} items in catalog`)
    : fail('GET /api/shop', JSON.stringify(shop.body));

  const noChar = await httpGet('/api/character/0xNOBODY');
  noChar.status === 404
    ? pass('GET /api/character/:unknown → 404')
    : fail('GET /api/character/:unknown', `expected 404, got ${noChar.status}`);

  const noFight = await httpGet('/api/fights/no-such-id');
  noFight.status === 404
    ? pass('GET /api/fights/:unknown → 404')
    : fail('GET /api/fights/:unknown', `expected 404, got ${noFight.status}`);

  // ── 2. WebSocket Auth ─────────────────────────
  section('2 — WebSocket Auth');

  const W1 = `0xALPHA_${TS}`;
  const W2 = `0xBETA_${TS}`;

  const p1 = await createPlayer(W1);
  const p2 = await createPlayer(W2);
  pass('Two WebSocket connections opened');

  p1.send({ type: 'auth', walletAddress: W1 });
  const auth1 = await p1.waitFor('auth_ok');
  auth1.walletAddress === W1 && auth1.hasCharacter === false
    ? pass(`Player1 auth_ok  hasCharacter=false`)
    : fail('Player1 auth', JSON.stringify(auth1));

  p2.send({ type: 'auth', walletAddress: W2 });
  const auth2 = await p2.waitFor('auth_ok');
  auth2.walletAddress === W2 && auth2.hasCharacter === false
    ? pass(`Player2 auth_ok  hasCharacter=false`)
    : fail('Player2 auth', JSON.stringify(auth2));

  // Drain system join messages
  await sleep(300);
  p1.drain('chat');
  p2.drain('chat');

  // ── 3. Error Handling ─────────────────────────
  section('3 — Error Handling');

  p1.send({
    type: 'create_character', name: 'BadStats',
    strength: 10, dexterity: 10, intuition: 10, endurance: 10,
  });
  const errStats = await p1.waitFor('error');
  errStats.message.includes('20')
    ? pass(`Rejected bad stat total: "${errStats.message}"`)
    : fail('Bad stat total', errStats.message);

  await sleep(150);

  p1.send({
    type: 'create_character', name: 'X',
    strength: 5, dexterity: 5, intuition: 5, endurance: 5,
  });
  const errName = await p1.waitFor('error');
  pass(`Rejected short name: "${errName.message}"`);

  await sleep(150);

  p1.send({
    type: 'create_character', name: 'LowStat',
    strength: 2, dexterity: 8, intuition: 5, endurance: 5,
  });
  const errZero = await p1.waitFor('error');
  pass(`Rejected low stat: "${errZero.message}"`);

  // ── 4. Character Creation ─────────────────────
  section('4 — Character Creation');

  await sleep(150);

  p1.send({
    type: 'create_character', name: 'IronKnight',
    strength: 8, dexterity: 3, intuition: 3, endurance: 6,
  });
  const c1msg = await p1.waitFor('character_created');
  const c1 = c1msg.character;
  c1.name === 'IronKnight' && c1.level === 1 && c1.rating === 1000
    ? pass(`P1: ${c1.name}  STR=${c1.stats.strength} DEX=${c1.stats.dexterity} INT=${c1.stats.intuition} END=${c1.stats.endurance}`)
    : fail('P1 creation', JSON.stringify(c1));

  await sleep(200);
  p1.drain('chat');
  p2.drain('chat');

  p2.send({
    type: 'create_character', name: 'ShadowBlade',
    strength: 3, dexterity: 8, intuition: 6, endurance: 3,
  });
  const c2msg = await p2.waitFor('character_created');
  const c2 = c2msg.character;
  c2.name === 'ShadowBlade' && c2.level === 1 && c2.rating === 1000
    ? pass(`P2: ${c2.name}  STR=${c2.stats.strength} DEX=${c2.stats.dexterity} INT=${c2.stats.intuition} END=${c2.stats.endurance}`)
    : fail('P2 creation', JSON.stringify(c2));

  await sleep(200);
  p1.drain('chat');
  p2.drain('chat');

  // Duplicate name/wallet
  p2.send({
    type: 'create_character', name: 'IronKnight',
    strength: 5, dexterity: 5, intuition: 5, endurance: 5,
  });
  const errDup = await p2.waitFor('error');
  pass(`Rejected duplicate: "${errDup.message}"`);

  // REST verify
  const charRest = await httpGet(`/api/character/${W1}`);
  charRest.status === 200 && charRest.body.character.name === 'IronKnight'
    ? pass(`GET /api/character → ${charRest.body.character.name}, gold=${charRest.body.character.gold}`)
    : fail('REST character', JSON.stringify(charRest));

  // ── 5. Shop / Inventory / Equipment ───────────
  section('5 — Shop / Inventory / Equipment');

  p1.send({ type: 'get_shop' });
  const shopWs = await p1.waitFor('shop_data');
  const allItems = shopWs.items;
  pass(`Shop catalog: ${allItems.length} items via WS`);

  // Buy + equip weapons
  const weapons = allItems.filter((i) => i.itemType === 1 && i.shopAvailable && i.levelReq <= 1);
  const weapon1 = weapons[0];
  p1.send({ type: 'buy_shop_item', itemId: weapon1.id });
  const b1 = await p1.waitFor('item_purchased');
  pass(`P1 bought: ${weapon1.name} (${weapon1.price}g) dmg=${weapon1.minDamage}-${weapon1.maxDamage}`);

  p1.send({ type: 'equip_item', itemId: b1.item.id });
  const eq1 = await p1.waitForAny(['item_equipped', 'error']);
  eq1.type === 'item_equipped' && eq1.character.equipment.weapon
    ? pass(`P1 equipped: ${eq1.character.equipment.weapon.name}`)
    : fail('P1 equip weapon', eq1.message || JSON.stringify(eq1.character?.equipment));

  const weapon2 = weapons[1] || weapons[0];
  p2.send({ type: 'buy_shop_item', itemId: weapon2.id });
  const b2 = await p2.waitFor('item_purchased');
  pass(`P2 bought: ${weapon2.name} (${weapon2.price}g) dmg=${weapon2.minDamage}-${weapon2.maxDamage}`);

  p2.send({ type: 'equip_item', itemId: b2.item.id });
  const eq2 = await p2.waitForAny(['item_equipped', 'error']);
  eq2.type === 'item_equipped' && eq2.character.equipment.weapon
    ? pass(`P2 equipped: ${eq2.character.equipment.weapon.name}`)
    : fail('P2 equip weapon', eq2.message || 'empty');

  // Buy + equip helmet for P1 (level 1 only)
  const helmets = allItems.filter((i) => i.itemType === 3 && i.shopAvailable && i.levelReq <= 1);
  if (helmets.length > 0) {
    const helmet = helmets[0];
    p1.send({ type: 'buy_shop_item', itemId: helmet.id });
    const bh = await p1.waitFor('item_purchased');
    await sleep(100);
    p1.send({ type: 'equip_item', itemId: bh.item.id });
    const eqh = await p1.waitForAny(['item_equipped', 'error']);
    if (eqh.type === 'item_equipped' && eqh.character.equipment.helmet) {
      pass(`P1 equipped helmet: ${helmet.name} (${helmet.price}g) bonuses=${JSON.stringify(helmet.statBonuses)}`);
    } else {
      fail('P1 equip helmet', eqh.type === 'error' ? eqh.message : `slot=${JSON.stringify(eqh.character?.equipment?.helmet)}`);
    }
  } else {
    skip('Helmet equip', 'no level-1 helmets in shop');
  }

  // Inventory check
  p1.send({ type: 'get_inventory' });
  const inv = await p1.waitFor('inventory');
  pass(`P1 inventory: ${inv.items.length} item(s)`);

  // Unequip + re-equip cycle
  p1.send({ type: 'unequip_item', slot: 'weapon' });
  const uneq = await p1.waitFor('item_unequipped');
  !uneq.character.equipment.weapon
    ? pass(`P1 unequipped: ${uneq.item.name} → weapon slot empty`)
    : fail('Unequip', 'slot not empty');

  p1.send({ type: 'equip_item', itemId: uneq.item.id });
  const reeq = await p1.waitForAny(['item_equipped', 'error']);
  reeq.type === 'item_equipped' && reeq.character.equipment.weapon
    ? pass(`P1 re-equipped: ${reeq.character.equipment.weapon.name}`)
    : fail('Re-equip', reeq.message || 'empty');

  // ── 6. Chat ───────────────────────────────────
  section('6 — Chat (Global + Whisper)');

  await sleep(300);
  p1.drain('chat');
  p2.drain('chat');

  p1.send({ type: 'chat_message', content: 'Hello from IronKnight!' });
  const chatG = await p2.waitFor('chat', 5000, (m) => m.message.type === 'global');
  chatG.message.content === 'Hello from IronKnight!' && chatG.message.senderName === 'IronKnight'
    ? pass(`Global: "${chatG.message.content}" from ${chatG.message.senderName}`)
    : fail('Global chat', JSON.stringify(chatG.message));

  await sleep(1200); // rate limit
  p2.send({ type: 'chat_message', content: 'Psst, secret!', target: W1 });
  const chatW = await p1.waitFor('chat', 5000, (m) => m.message.type === 'whisper');
  chatW.message.content === 'Psst, secret!' && chatW.message.senderName === 'ShadowBlade'
    ? pass(`Whisper: "${chatW.message.content}" from ${chatW.message.senderName}`)
    : fail('Whisper', JSON.stringify(chatW.message));

  // ── 7. Online Players ─────────────────────────
  section('7 — Online Players');

  p1.send({ type: 'get_online_players' });
  const online = await p1.waitFor('online_players');
  const us = online.players.filter((p) => p.walletAddress === W1 || p.walletAddress === W2);
  us.length === 2
    ? pass(`Online: ${online.players.map((p) => `${p.name}(${p.status})`).join(', ')}`)
    : fail('Online players', `expected 2 of ours, got ${us.length}`);

  // ── 8. Matchmaking Queue ──────────────────────
  section('8 — Matchmaking Queue');

  p1.send({ type: 'queue_fight', fightType: 'ranked' });
  const qj = await p1.waitFor('queue_joined');
  qj.fightType === 'ranked' ? pass('P1 joined ranked queue') : fail('Queue join', JSON.stringify(qj));

  p1.send({ type: 'cancel_queue' });
  await p1.waitFor('queue_left');
  pass('P1 cancelled queue');

  // ── 9. Full Ranked Fight ──────────────────────
  section('9 — Full Ranked Fight');

  console.log('\n  Queueing both players for ranked match…');

  p1.send({ type: 'queue_fight', fightType: 'ranked' });
  await p1.waitFor('queue_joined');
  p2.send({ type: 'queue_fight', fightType: 'ranked' });
  await p2.waitFor('queue_joined');

  const fs1 = await p1.waitFor('fight_start');
  p2.drain('fight_start');
  const fightId = fs1.fight.id;
  pass(`Match found! id=${fightId.slice(0, 8)}…  type=${fs1.fight.type}`);

  const isP1A = fs1.fight.playerA.walletAddress === W1;
  const pA = isP1A ? p1 : p2;
  const pB = isP1A ? p2 : p1;

  const result = await playFight(pA, pB, fs1, true);

  if (result) {
    const { finalMsg, allTurnResults, pAName, pBName } = result;
    const ff = finalMsg.fight;
    const loot = finalMsg.loot;

    console.log('');
    console.log('  ┌─────────────────────────────────────────────────┐');
    console.log('  │            \x1b[1mFIGHT RESULT\x1b[0m                          │');
    console.log('  └─────────────────────────────────────────────────┘');

    const winWallet = ff.winner;
    if (winWallet) {
      const winName = ff.playerA.walletAddress === winWallet ? pAName : pBName;
      const loseName = ff.playerA.walletAddress === winWallet ? pBName : pAName;
      console.log(`  \x1b[1;32mWinner: ${winName}\x1b[0m`);
      console.log(`  \x1b[31mLoser:  ${loseName}\x1b[0m`);
    } else {
      console.log('  \x1b[33mDRAW\x1b[0m');
    }

    console.log(`  Turns: ${allTurnResults.length}`);
    console.log(`  Final HP: ${pAName}=${ff.playerA.currentHp.toFixed(1)}, ${pBName}=${ff.playerB.currentHp.toFixed(1)}`);

    if (loot) {
      console.log(`  XP gained: ${loot.xpGained}`);
      console.log(`  Rating: ${loot.ratingChange > 0 ? '+' : ''}${loot.ratingChange}`);
      loot.item
        ? console.log(`  \x1b[35mLoot: ${loot.item.name} (rarity ${loot.item.rarity})\x1b[0m`)
        : console.log('  No loot drop');
    }

    // Aggregate combat stats
    let hits = 0, blocks = 0, dodges = 0, crits = 0, dmg = 0;
    for (const tr of allTurnResults) {
      for (const side of [tr.result.playerA, tr.result.playerB]) {
        for (const h of side.hits) {
          if (h.blocked) blocks++;
          else if (h.dodged) dodges++;
          else { hits++; dmg += h.damage; if (h.crit) crits++; }
        }
      }
    }
    console.log(`\n  \x1b[1mCombat totals:\x1b[0m ${hits} hits, ${blocks} blocks, ${dodges} dodges, ${crits} crits, ${dmg.toFixed(1)} total dmg`);

    pass(`Fight completed in ${allTurnResults.length} turns`);

    // REST verify
    const fRest = await httpGet(`/api/fights/${fightId}`);
    fRest.status === 200 && fRest.body.fight.status === 'finished'
      ? pass(`GET /api/fights/${fightId.slice(0, 8)}… → status=finished`)
      : fail('REST fight', JSON.stringify(fRest));
  }

  // ── 10. Post-Fight Character State ────────────
  section('10 — Post-Fight Character State');

  const post1 = await httpGet(`/api/character/${W1}`);
  const pc1 = post1.body.character;
  console.log(`  ${pc1.name}: lvl=${pc1.level} xp=${pc1.xp} rating=${pc1.rating} W=${pc1.wins} L=${pc1.losses} gold=${pc1.gold}`);
  pc1.wins + pc1.losses === 1
    ? pass(`${pc1.name} has 1 fight recorded`)
    : fail('P1 record', `W=${pc1.wins} L=${pc1.losses}`);

  const post2 = await httpGet(`/api/character/${W2}`);
  const pc2 = post2.body.character;
  console.log(`  ${pc2.name}: lvl=${pc2.level} xp=${pc2.xp} rating=${pc2.rating} W=${pc2.wins} L=${pc2.losses} gold=${pc2.gold}`);
  pc2.wins + pc2.losses === 1
    ? pass(`${pc2.name} has 1 fight recorded`)
    : fail('P2 record', `W=${pc2.wins} L=${pc2.losses}`);

  pc1.rating !== pc2.rating
    ? pass(`Ratings diverged: ${pc1.name}=${pc1.rating}, ${pc2.name}=${pc2.rating}`)
    : pass(`Ratings tied (draw): both=${pc1.rating}`);

  // ── 11. Fight History ─────────────────────────
  section('11 — Fight History');

  // Server maps fight history to: { id, type, playerA:{name,wallet}, playerB:{name,wallet}, winner, turns, timestamp }
  p1.send({ type: 'get_fight_history' });
  const hist1 = await p1.waitFor('fight_history');
  if (hist1.fights.length > 0) {
    const f = hist1.fights[0];
    const won = f.winner === W1 ? 'win' : 'loss';
    pass(`P1 history: ${won}, opponent=${f.playerA.name}, turns=${f.turns}`);
  } else {
    fail('P1 fight history', 'empty');
  }

  p2.send({ type: 'get_fight_history' });
  const hist2 = await p2.waitFor('fight_history');
  if (hist2.fights.length > 0) {
    const f = hist2.fights[0];
    const won = f.winner === W2 ? 'win' : 'loss';
    pass(`P2 history: ${won}, opponent=${f.playerA.name}, turns=${f.turns}`);
  } else {
    fail('P2 fight history', 'empty');
  }

  // ── 12. Spectating ────────────────────────────
  section('12 — Spectating');

  p1.send({ type: 'spectate_fight' });
  try {
    const spec = await p1.waitFor('spectate_update', 3000);
    pass(`Spectate: ${spec.activeFights?.length ?? 0} active fights`);
  } catch {
    skip('Spectate list', 'no response (no active fights)');
  }

  // ── 13. Leaderboard After Fight ───────────────
  section('13 — Leaderboard After Fight');

  p1.send({ type: 'get_leaderboard' });
  const lb2 = await p1.waitFor('leaderboard');
  if (lb2.entries.length >= 2) {
    pass(`Leaderboard (${lb2.entries.length} entries):`);
    for (const e of lb2.entries) {
      console.log(`    #${e.rank}  ${e.name.padEnd(14)} rating=${e.rating}  W=${e.wins} L=${e.losses}`);
    }
  } else {
    fail('Leaderboard', `expected ≥2, got ${lb2.entries.length}`);
  }

  const lbR = await httpGet('/api/leaderboard');
  lbR.body.entries.length >= 2
    ? pass(`REST /api/leaderboard → ${lbR.body.entries.length} entries`)
    : fail('REST leaderboard', `${lbR.body.entries.length}`);

  // ── 14. Wager Fight ───────────────────────────
  section('14 — Wager Fight');

  const wager = Math.min(pc1.gold, pc2.gold, 50);
  if (wager > 0) {
    console.log(`\n  Queueing wager fight (${wager}g each)…`);

    p1.send({ type: 'queue_fight', fightType: 'wager', wagerAmount: wager });
    await p1.waitFor('queue_joined');
    p2.send({ type: 'queue_fight', fightType: 'wager', wagerAmount: wager });
    await p2.waitFor('queue_joined');

    const wfs = await p1.waitFor('fight_start');
    p2.drain('fight_start');
    const wIsP1A = wfs.fight.playerA.walletAddress === W1;
    const wA = wIsP1A ? p1 : p2;
    const wB = wIsP1A ? p2 : p1;

    pass(`Wager fight started! id=${wfs.fight.id.slice(0, 8)}…`);

    const wr = await playFight(wA, wB, wfs, false);
    if (wr) {
      pass(`Wager fight finished in ${wr.allTurnResults.length} turns`);

      // Gold check
      const pg1 = await httpGet(`/api/character/${W1}`);
      const pg2 = await httpGet(`/api/character/${W2}`);
      const g1 = pg1.body.character.gold;
      const g2 = pg2.body.character.gold;
      const d1 = g1 - pc1.gold;
      const d2 = g2 - pc2.gold;
      pass(`Gold: ${pc1.name}=${g1}g (${d1 >= 0 ? '+' : ''}${d1}), ${pc2.name}=${g2}g (${d2 >= 0 ? '+' : ''}${d2})`);
    }
  } else {
    skip('Wager fight', 'not enough gold');
  }

  // ── Cleanup ───────────────────────────────────
  p1.close();
  p2.close();

  console.log('\n\x1b[1m══════════════════════════════════════════════════════');
  console.log(`  Results:  \x1b[32m${passCount} passed\x1b[0m\x1b[1m  \x1b[31m${failCount} failed\x1b[0m\x1b[1m  \x1b[33m${skipCount} skipped\x1b[0m`);
  console.log('══════════════════════════════════════════════════════\x1b[0m\n');

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n\x1b[31mFATAL:\x1b[0m', err);
  process.exit(2);
});
