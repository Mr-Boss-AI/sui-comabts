import WebSocket from 'ws';

const WS_URL = 'ws://localhost:3001';
const WALLET = '0xa953bea7f2a24a976525909a57fc48636843f9baf867ccf171a52e6a795307eb';
const ZONES = ['head', 'chest', 'stomach', 'belt', 'legs'];
const ADJACENT_BLOCKS = [
  ['head', 'chest'],
  ['chest', 'stomach'],
  ['stomach', 'belt'],
  ['belt', 'legs'],
];

function randomAttack() {
  return [ZONES[Math.floor(Math.random() * ZONES.length)]];
}

function randomBlock() {
  return ADJACENT_BLOCKS[Math.floor(Math.random() * ADJACENT_BLOCKS.length)];
}

function log(msg) {
  console.log(`[Big Bad Claude] ${msg}`);
}

let hasWeapon = false;
const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  log('Connected to ws://localhost:3001');
  ws.send(JSON.stringify({ type: 'auth', walletAddress: WALLET }));
});

ws.on('close', () => { log('Disconnected'); clearInterval(keepAlive); });
ws.on('error', (e) => log(`Error: ${e.message}`));

// Keep the connection alive with periodic pings
const keepAlive = setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) ws.ping();
}, 15000);

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());

  switch (msg.type) {
    case 'auth_ok': {
      log(`Authenticated as ${WALLET}`);
      if (msg.hasCharacter) {
        log('Character already exists, checking equipment...');
        ws.send(JSON.stringify({ type: 'get_character' }));
      } else {
        log('Creating character: Big Bad Claude (STR=8 DEX=4 INT=4 END=4)');
        ws.send(JSON.stringify({
          type: 'create_character',
          name: 'Big Bad Claude',
          strength: 8, dexterity: 4, intuition: 4, endurance: 4,
        }));
      }
      break;
    }

    case 'character_created': {
      const c = msg.character;
      log(`Character created! ${c.name} — STR=${c.stats.strength} DEX=${c.stats.dexterity} INT=${c.stats.intuition} END=${c.stats.endurance}`);
      log('Fetching shop...');
      ws.send(JSON.stringify({ type: 'get_shop' }));
      break;
    }

    case 'character_data': {
      const c = msg.character;
      log(`Loaded: ${c.name} — STR=${c.stats.strength} DEX=${c.stats.dexterity} INT=${c.stats.intuition} END=${c.stats.endurance}`);
      if (c.equipment?.weapon) {
        hasWeapon = true;
        log(`Already equipped: ${c.equipment.weapon.name}`);
        joinQueue();
      } else {
        log('No weapon equipped, fetching shop...');
        ws.send(JSON.stringify({ type: 'get_shop' }));
      }
      break;
    }

    case 'shop_data': {
      if (hasWeapon) {
        log('Already have a weapon equipped, skipping shop');
        joinQueue();
        break;
      }
      const weapons = msg.items.filter(i => i.itemType === 1 && i.shopAvailable && i.levelReq <= 1);
      if (weapons.length > 0) {
        const w = weapons[0];
        log(`Buying weapon: ${w.name} (${w.price}g, dmg ${w.minDamage}-${w.maxDamage})`);
        ws.send(JSON.stringify({ type: 'buy_shop_item', itemId: w.id }));
      } else {
        log('No weapons available, joining queue anyway');
        joinQueue();
      }
      break;
    }

    case 'item_purchased': {
      const item = msg.item;
      log(`Purchased: ${item.name} — equipping...`);
      ws.send(JSON.stringify({ type: 'equip_item', itemId: item.id }));
      break;
    }

    case 'item_equipped': {
      const eq = msg.character.equipment;
      log(`Equipped weapon: ${eq.weapon?.name || 'unknown'}`);
      joinQueue();
      break;
    }

    case 'queue_joined': {
      log(`Joined ${msg.fightType} queue. Waiting for opponent...`);
      break;
    }

    case 'fight_start': {
      const f = msg.fight;
      console.log('');
      console.log('='.repeat(55));
      console.log(`  FIGHT START: ${f.playerA.name} vs ${f.playerB.name}`);
      console.log(`  HP: ${f.playerA.maxHp} vs ${f.playerB.maxHp}`);
      console.log(`  Type: ${f.type}`);
      console.log('='.repeat(55));
      break;
    }

    case 'turn_start': {
      const atk = randomAttack();
      const blk = randomBlock();
      log(`Turn ${msg.turn}: attacking [${atk}], blocking [${blk}]`);
      ws.send(JSON.stringify({ type: 'fight_action', attackZones: atk, blockZones: blk }));
      break;
    }

    case 'turn_result': {
      const r = msg.result;
      const f = msg.fight;
      console.log(`\n--- Turn ${r.turn} Results ---`);
      printSide(f.playerA.name, r.playerA, f.playerA.currentHp);
      printSide(f.playerB.name, r.playerB, f.playerB.currentHp);
      break;
    }

    case 'fight_end': {
      const f = msg.fight;
      const loot = msg.loot;
      const pA = f.playerA;
      const pB = f.playerB;
      const winnerName = f.winner === pA.walletAddress ? pA.name : pB.name;
      const loserName = f.winner === pA.walletAddress ? pB.name : pA.name;

      console.log('');
      console.log('='.repeat(55));
      console.log(`  FIGHT OVER`);
      console.log(`  Winner: ${winnerName}`);
      console.log(`  Loser:  ${loserName}`);
      console.log(`  Final HP: ${pA.name}=${pA.currentHp.toFixed(1)}, ${pB.name}=${pB.currentHp.toFixed(1)}`);
      if (loot) {
        console.log(`  XP gained: ${loot.xpGained}`);
        console.log(`  Rating: ${loot.ratingChange > 0 ? '+' : ''}${loot.ratingChange}`);
        if (loot.item) console.log(`  Loot: ${loot.item.name} (rarity ${loot.item.rarity})`);
      }
      console.log('='.repeat(55));
      console.log('');
      log('Fight complete. Re-queuing in 5 seconds...');
      setTimeout(() => joinQueue(), 5000);
      break;
    }

    case 'fight_action_ack':
      break;

    case 'chat': {
      if (msg.message?.type === 'system') break;
      const sender = msg.message?.senderName || 'unknown';
      const content = msg.message?.content || '';
      log(`Chat [${sender}]: ${content}`);

      // Don't reply to own messages
      if (msg.message?.sender === WALLET) break;

      // Reply to messages
      setTimeout(() => {
        const reply = generateReply(sender, content);
        if (reply) {
          ws.send(JSON.stringify({ type: 'chat_message', content: reply }));
          log(`Replied: ${reply}`);
        }
      }, 1500);
      break;
    }

    case 'error':
      log(`Server error: ${msg.message}`);
      if (msg.message && msg.message.includes('already has a character')) {
        log('Character exists, skipping creation. Fetching shop...');
        ws.send(JSON.stringify({ type: 'get_shop' }));
      }
      break;

    default:
      break;
  }
});

function joinQueue() {
  log('Joining ranked matchmaking queue...');
  ws.send(JSON.stringify({ type: 'queue_fight', fightType: 'ranked' }));
  // Send a greeting in chat
  setTimeout(() => {
    const greetings = [
      "Big Bad Claude has entered the arena. Who dares challenge me?",
      "I smell fresh meat. Queue up if you want to lose.",
      "Another day, another victory. Come at me.",
    ];
    const greeting = greetings[Math.floor(Math.random() * greetings.length)];
    ws.send(JSON.stringify({ type: 'chat_message', content: greeting }));
  }, 1000);
}

const REPLIES = [
  "You talk big, but can you fight?",
  "Interesting... let's settle this in the arena.",
  "Ha! I've heard that before. Queue up.",
  "Big Bad Claude fears no one.",
  "Less talking, more fighting. Join the queue!",
  "My Rusty Sword is thirsty for battle.",
  "Is that all you've got? Words won't save you.",
  "I respect the confidence. Now prove it.",
  "You remind me of my last opponent... they lost too.",
  "Bring it on! I'm waiting in the friendly queue.",
];

const GREETING_REPLIES = [
  "Hey! Ready for a fight?",
  "Welcome! Queue up and let's brawl.",
  "Greetings, warrior. Prepare yourself.",
];

function generateReply(sender, content) {
  const lower = content.toLowerCase();
  if (lower.match(/^(hi|hey|hello|yo|sup|greetings|hola|what'?s up)/)) {
    return GREETING_REPLIES[Math.floor(Math.random() * GREETING_REPLIES.length)];
  }
  if (lower.includes('gg') || lower.includes('good game') || lower.includes('nice fight')) {
    return "GG! That was a good fight. Rematch?";
  }
  if (lower.includes('?')) {
    return "Good question. But the real answer is in the arena.";
  }
  // Random reply for anything else
  return REPLIES[Math.floor(Math.random() * REPLIES.length)];
}

function printSide(name, sideResult, hpAfter) {
  const atk = sideResult.actions?.attackZones || [];
  const blk = sideResult.actions?.blockZones || [];
  console.log(`  ${name}  atk=[${atk}]  blk=[${blk}]`);
  for (const hit of sideResult.hits) {
    if (hit.blocked) console.log(`    ${hit.zone.padEnd(8)} BLOCKED`);
    else if (hit.dodged) console.log(`    ${hit.zone.padEnd(8)} DODGED`);
    else if (hit.crit) console.log(`    ${hit.zone.padEnd(8)} CRIT ${hit.damage.toFixed(1)} dmg`);
    else console.log(`    ${hit.zone.padEnd(8)} HIT  ${hit.damage.toFixed(1)} dmg`);
  }
  console.log(`  HP: ${hpAfter.toFixed(1)}`);
}
