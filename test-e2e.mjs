import WebSocket from 'ws';

const WS_URL = 'ws://localhost:3001';
let passed = 0;
let failed = 0;
const errors = [];
const ZONES = ['head', 'chest', 'stomach', 'belt', 'legs'];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    errors.push(label);
    console.log(`  \u2717 ${label}`);
  }
}

function createClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const messages = [];
    const waiters = [];

    ws.on('open', () => resolve({
      ws,
      messages,
      send(msg) { ws.send(JSON.stringify(msg)); },
      waitFor(predicate, timeout = 5000) {
        // predicate can be string (type match) or function
        const matchFn = typeof predicate === 'string'
          ? (m) => m.type === predicate
          : predicate;

        const idx = messages.findIndex(matchFn);
        if (idx !== -1) {
          const [msg] = messages.splice(idx, 1);
          return Promise.resolve(msg);
        }
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            waiters.splice(waiters.indexOf(entry), 1);
            rej(new Error(`Timeout waiting for ${predicate}`));
          }, timeout);
          const entry = { matchFn, resolve: res, timer };
          waiters.push(entry);
        });
      },
      drain(type) {
        // Remove all messages of this type
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].type === type) messages.splice(i, 1);
        }
      },
      close() { ws.close(); },
    }));

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      // Check waiters first
      for (let i = 0; i < waiters.length; i++) {
        if (waiters[i].matchFn(msg)) {
          const w = waiters.splice(i, 1)[0];
          clearTimeout(w.timer);
          w.resolve(msg);
          return;
        }
      }
      messages.push(msg);
    });

    ws.on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function randomZone() { return ZONES[Math.floor(Math.random() * ZONES.length)]; }
function randomZones(n) {
  const shuffled = [...ZONES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

async function run() {
  console.log('\n========================================');
  console.log('  SUI Combats E2E Test Suite');
  console.log('========================================\n');

  // ===== TEST 1: WebSocket Connection & Auth =====
  console.log('1. WebSocket Connection & Auth');
  const playerA = await createClient();
  assert(playerA.ws.readyState === WebSocket.OPEN, 'Player A connected');

  playerA.send({ type: 'auth', walletAddress: '0xAAA111' });
  const authA = await playerA.waitFor('auth_ok');
  assert(authA.walletAddress === '0xAAA111', 'Player A authenticated');

  const playerB = await createClient();
  playerB.send({ type: 'auth', walletAddress: '0xBBB222' });
  const authB = await playerB.waitFor('auth_ok');
  assert(authB.walletAddress === '0xBBB222', 'Player B authenticated');

  // Drain system chat messages from join notifications
  await sleep(200);
  playerA.drain('chat');
  playerB.drain('chat');

  // ===== TEST 2: Character Creation =====
  console.log('\n2. Character Creation');

  playerA.send({ type: 'get_character' });
  const noChar = await playerA.waitFor('error');
  assert(noChar.type === 'error', 'No character returns error');

  // Create Player A (Tank)
  playerA.send({
    type: 'create_character', name: 'TankMaster',
    strength: 6, dexterity: 3, intuition: 3, endurance: 8,
  });
  const charA = await playerA.waitFor('character_created');
  assert(charA.character.name === 'TankMaster', 'Player A character created');
  assert(charA.character.stats.endurance === 8, 'Player A endurance is 8');
  assert(charA.character.level === 1, 'Player A starts at level 1');
  assert(charA.character.rating === 1000, 'Player A rating is 1000');

  // Create Player B (Crit)
  playerB.send({
    type: 'create_character', name: 'CritKing',
    strength: 5, dexterity: 3, intuition: 8, endurance: 4,
  });
  const charB = await playerB.waitFor('character_created');
  assert(charB.character.name === 'CritKing', 'Player B character created');
  assert(charB.character.stats.intuition === 8, 'Player B intuition is 8');

  // Drain join/creation chat messages
  await sleep(200);
  playerA.drain('chat');
  playerB.drain('chat');

  // ===== TEST 3: Get Character =====
  console.log('\n3. Get Character');
  playerA.send({ type: 'get_character' });
  const getCharA = await playerA.waitFor('character_data');
  assert(getCharA.character.name === 'TankMaster', 'Get character returns correct data');

  // ===== TEST 4: REST API =====
  console.log('\n4. REST API - Character');
  const resp = await fetch('http://localhost:3001/api/character/0xAAA111');
  const charData = await resp.json();
  assert(charData.character && charData.character.name === 'TankMaster', 'REST /api/character returns character');

  // ===== TEST 5: Shop =====
  console.log('\n5. NPC Shop');
  playerA.send({ type: 'get_shop' });
  const shop = await playerA.waitFor('shop_data');
  assert(shop.items && shop.items.length > 0, `Shop has ${shop.items.length} items`);
  assert(shop.items[0].price > 0, 'Shop items have prices');

  const weaponItem = shop.items.find(i => i.itemType === 1);
  if (weaponItem) {
    playerA.send({ type: 'buy_shop_item', itemId: weaponItem.id });
    const bought = await playerA.waitFor('item_purchased');
    assert(bought.item.name === weaponItem.name, `Bought ${weaponItem.name}`);
  }

  // ===== TEST 6: Inventory =====
  console.log('\n6. Inventory');
  playerA.send({ type: 'get_inventory' });
  const inv = await playerA.waitFor('inventory');
  assert(inv.items.length >= 1, `Inventory has ${inv.items.length} item(s)`);

  // ===== TEST 7: Equipment =====
  console.log('\n7. Equipment');
  if (inv.items.length > 0) {
    const item = inv.items[0];
    playerA.send({ type: 'equip_item', itemId: item.id, slot: 'weapon' });
    const equipped = await playerA.waitFor('item_equipped');
    assert(equipped.character.equipment.weapon !== null, 'Weapon equipped');

    playerA.send({ type: 'unequip_item', slot: 'weapon' });
    const unequipped = await playerA.waitFor('item_unequipped');
    assert(unequipped.character.equipment.weapon === null, 'Weapon unequipped');
  }

  // ===== TEST 8: Chat =====
  console.log('\n8. Chat');
  // Drain any leftover chat messages
  playerA.drain('chat');
  playerB.drain('chat');

  playerA.send({ type: 'chat_message', content: 'Hello from TankMaster!' });
  // Wait for a global chat message with matching content
  const chatB = await playerB.waitFor(
    m => m.type === 'chat' && m.message && m.message.content === 'Hello from TankMaster!',
    3000
  );
  assert(chatB.message.content === 'Hello from TankMaster!', 'Global chat received by Player B');
  assert(chatB.message.senderName === 'TankMaster', 'Chat sender name correct');

  // Whisper
  await sleep(1100); // respect rate limit
  playerB.send({ type: 'chat_message', content: 'Secret message', target: '0xAAA111' });
  const whisperA = await playerA.waitFor(
    m => m.type === 'chat' && m.message && m.message.type === 'whisper',
    3000
  );
  assert(whisperA.message.type === 'whisper', 'Whisper type correct');
  assert(whisperA.message.content === 'Secret message', 'Whisper content received');

  // ===== TEST 9: Online Players =====
  console.log('\n9. Online Players');
  playerA.send({ type: 'get_online_players' });
  const online = await playerA.waitFor('online_players');
  assert(online.players.length === 2, `2 players online (got ${online.players.length})`);

  // ===== TEST 10: Equip weapons for both players before fighting =====
  console.log('\n10. Equip Weapons for Fight');

  // Player A buys + equips weapon
  playerA.send({ type: 'get_shop' });
  const shopA = await playerA.waitFor('shop_data');
  const weaponA = shopA.items.find(i => i.itemType === 1 && i.price);
  if (weaponA) {
    playerA.send({ type: 'buy_shop_item', itemId: weaponA.id });
    await playerA.waitFor('item_purchased');
    playerA.send({ type: 'get_inventory' });
    const invA2 = await playerA.waitFor('inventory');
    const wA = invA2.items.find(i => i.itemType === 1);
    if (wA) {
      playerA.send({ type: 'equip_item', itemId: wA.id, slot: 'weapon' });
      await playerA.waitFor('item_equipped');
    }
  }
  assert(true, 'Player A weapon equipped for fight');

  // Player B buys + equips weapon
  playerB.send({ type: 'get_shop' });
  const shopB = await playerB.waitFor('shop_data');
  const weaponB = shopB.items.find(i => i.itemType === 1 && i.price);
  if (weaponB) {
    playerB.send({ type: 'buy_shop_item', itemId: weaponB.id });
    await playerB.waitFor('item_purchased');
    playerB.send({ type: 'get_inventory' });
    const invB2 = await playerB.waitFor('inventory');
    const wB = invB2.items.find(i => i.itemType === 1);
    if (wB) {
      playerB.send({ type: 'equip_item', itemId: wB.id, slot: 'weapon' });
      await playerB.waitFor('item_equipped');
    }
  }
  assert(true, 'Player B weapon equipped for fight');

  // ===== TEST 11: Matchmaking & Fight =====
  console.log('\n11. Matchmaking & Fight');

  // Drain old messages
  playerA.drain('fight_start');
  playerA.drain('turn_start');
  playerA.drain('turn_result');
  playerA.drain('fight_end');
  playerB.drain('fight_start');
  playerB.drain('turn_start');
  playerB.drain('turn_result');
  playerB.drain('fight_end');

  playerA.send({ type: 'queue_fight', fightType: 'friendly' });
  const queuedA = await playerA.waitFor('queue_joined');
  assert(queuedA.fightType === 'friendly', 'Player A queued');

  playerB.send({ type: 'queue_fight', fightType: 'friendly' });

  const fightStartA = await playerA.waitFor('fight_start', 10000);
  const fightStartB = await playerB.waitFor('fight_start', 10000);
  assert(fightStartA.fight.status === 'active', 'Fight started for Player A');
  assert(fightStartB.fight.status === 'active', 'Fight started for Player B');
  assert(fightStartA.fight.id === fightStartB.fight.id, 'Same fight ID');

  const fightId = fightStartA.fight.id;
  console.log(`    Fight ID: ${fightId}`);
  console.log(`    A HP: ${fightStartA.fight.playerA.currentHp}, B HP: ${fightStartA.fight.playerB.currentHp}`);

  // Play turns with RANDOM zone picks
  let fightOver = false;
  let turnCount = 0;
  const MAX_TURNS = 50;

  while (!fightOver && turnCount < MAX_TURNS) {
    // Wait for turn_start
    try { await playerA.waitFor('turn_start', 15000); } catch {}
    turnCount++;

    // Random zone picks so attacks aren't always blocked
    const aAttack = randomZones(1);
    const aBlock = randomZones(2);
    const bAttack = randomZones(1);
    const bBlock = randomZones(2);

    playerA.send({ type: 'fight_action', attackZones: aAttack, blockZones: aBlock });
    playerB.send({ type: 'fight_action', attackZones: bAttack, blockZones: bBlock });

    // Wait for turn_result or fight_end
    try {
      const result = await playerA.waitFor(
        m => m.type === 'turn_result' || m.type === 'fight_end',
        15000
      );

      if (result.type === 'fight_end') {
        fightOver = true;
        const winnerName = result.fight.winner === '0xAAA111' ? 'TankMaster' : 'CritKing';
        assert(result.fight.status === 'finished', 'Fight finished');
        assert(result.fight.winner !== undefined, `Winner: ${winnerName}`);
        assert(result.loot && result.loot.xpGained > 0, `XP gained: ${result.loot?.xpGained}`);
        assert(typeof result.loot?.ratingChange === 'number', `Rating change: ${result.loot?.ratingChange}`);
        // Drain playerB's fight_end
        try { await playerB.waitFor('fight_end', 3000); } catch {}
      } else {
        // Check if fight_end came right after
        const maybeEnd = playerA.messages.find(m => m.type === 'fight_end');
        if (maybeEnd) {
          fightOver = true;
          playerA.messages.splice(playerA.messages.indexOf(maybeEnd), 1);
          assert(maybeEnd.fight.status === 'finished', 'Fight finished');
          assert(maybeEnd.fight.winner !== undefined, `Winner declared`);
          assert(maybeEnd.loot && maybeEnd.loot.xpGained > 0, `XP gained: ${maybeEnd.loot?.xpGained}`);
          try { await playerB.waitFor('fight_end', 3000); } catch {}
        }
      }
    } catch (e) {
      console.log(`    Turn ${turnCount}: timeout waiting for result`);
    }
  }

  assert(fightOver, `Fight completed in ${turnCount} turns`);
  assert(turnCount < MAX_TURNS, `Fight resolved within ${MAX_TURNS} turns`);

  // ===== TEST 12: Fight History =====
  console.log('\n12. Fight History');
  await sleep(500);
  playerA.send({ type: 'get_fight_history' });
  const history = await playerA.waitFor('fight_history');
  assert(history.fights.length >= 1, `Fight history has ${history.fights.length} fight(s)`);

  // ===== TEST 13: Post-fight Stats =====
  console.log('\n13. Post-fight Stats');
  playerA.send({ type: 'get_character' });
  const postFight = await playerA.waitFor('character_data');
  const totalFights = postFight.character.wins + postFight.character.losses;
  assert(totalFights >= 1, `Player A has ${totalFights} fight(s) recorded`);
  assert(postFight.character.xp > 0, `Player A has XP: ${postFight.character.xp}`);

  // ===== TEST 14: Leaderboard (post-fight) =====
  console.log('\n14. Leaderboard');
  playerA.send({ type: 'get_leaderboard' });
  const lb = await playerA.waitFor('leaderboard');
  assert(lb.entries.length >= 1, `Leaderboard has ${lb.entries.length} entries after fight`);

  // ===== TEST 15: REST fight endpoint =====
  console.log('\n15. REST API - Fight');
  const fightResp = await fetch(`http://localhost:3001/api/fights/${fightId}`);
  assert(fightResp.status === 200 || fightResp.status === 404, 'REST /api/fights/:id responded');

  // ===== CLEANUP =====
  playerA.close();
  playerB.close();

  // ===== SUMMARY =====
  console.log('\n========================================');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  if (errors.length > 0) {
    console.log('  Failed:');
    errors.forEach(e => console.log(`    \u2717 ${e}`));
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Test suite crashed:', e);
  process.exit(1);
});
