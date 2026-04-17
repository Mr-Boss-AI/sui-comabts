import { execSync } from 'child_process';
import { CONFIG } from '../config';

const PACKAGE_ID = CONFIG.SUI_PACKAGE_ID;

/**
 * Call settle_wager on-chain. The winner gets 95%, treasury gets 5%.
 * Only the TREASURY wallet (server) can call this (admin check in contract).
 */
export async function settleWagerOnChain(
  wagerMatchId: string,
  winnerAddress: string,
): Promise<{ digest: string }> {
  try {
    console.log(`[Wager] Settling ${wagerMatchId} → winner: ${winnerAddress}`);

    const cmd = [
      'sui client call',
      `--package ${PACKAGE_ID}`,
      '--module arena',
      '--function settle_wager',
      `--args ${wagerMatchId} ${winnerAddress}`,
      '--gas-budget 50000000',
      '--json',
    ].join(' ');

    const result = execSync(cmd, {
      timeout: 30_000,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
    });

    const json = JSON.parse(result);
    const digest = json.digest || json.effects?.transactionDigest || 'unknown';
    console.log(`[Wager] Settled on-chain. Tx: ${digest}`);
    return { digest };
  } catch (err: any) {
    console.error('[Wager] Settlement failed:', err.message || err);
    throw new Error(`Wager settlement failed: ${err.message || 'unknown error'}`);
  }
}

/**
 * Admin-cancel a wager on-chain. Only the TREASURY wallet can call this.
 * WAITING state: refunds player_a.
 * ACTIVE state: refunds both players 50/50.
 */
export async function adminCancelWagerOnChain(
  wagerMatchId: string,
): Promise<{ digest: string }> {
  try {
    console.log(`[Wager] Admin-cancelling ${wagerMatchId}`);

    const cmd = [
      'sui client call',
      `--package ${PACKAGE_ID}`,
      '--module arena',
      '--function admin_cancel_wager',
      `--args ${wagerMatchId}`,
      '--gas-budget 50000000',
      '--json',
    ].join(' ');

    const result = execSync(cmd, {
      timeout: 30_000,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
    });

    const json = JSON.parse(result);
    const digest = json.digest || json.effects?.transactionDigest || 'unknown';
    console.log(`[Wager] Admin-cancelled on-chain. Tx: ${digest}`);
    return { digest };
  } catch (err: any) {
    console.error('[Wager] Admin cancel failed:', err.message || err);
    throw new Error(`Wager admin cancel failed: ${err.message || 'unknown error'}`);
  }
}

/**
 * Call update_after_fight on-chain to persist fight results to the Character NFT.
 * Requires AdminCap (held by TREASURY wallet).
 */
export async function updateCharacterOnChain(
  characterObjectId: string,
  won: boolean,
  xpGained: number,
  newRating: number,
): Promise<{ digest: string }> {
  try {
    console.log(`[Character] Updating on-chain: ${characterObjectId} (won=${won}, xp=${xpGained}, rating=${newRating})`);

    const cmd = [
      'sui client call',
      `--package ${PACKAGE_ID}`,
      '--module character',
      '--function update_after_fight',
      `--args ${CONFIG.ADMIN_CAP_ID} ${characterObjectId} ${won} ${xpGained} ${newRating} 0x6`,
      '--gas-budget 50000000',
      '--json',
    ].join(' ');

    const result = execSync(cmd, {
      timeout: 30_000,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
    });

    const json = JSON.parse(result);
    const digest = json.digest || json.effects?.transactionDigest || 'unknown';
    console.log(`[Character] Updated on-chain. Tx: ${digest}`);
    return { digest };
  } catch (err: any) {
    console.error('[Character] On-chain update failed:', err.message || err);
    throw new Error(`Character update failed: ${err.message || 'unknown error'}`);
  }
}

/**
 * Find a Character object ID by owner address via RPC.
 * Queries CharacterCreated events to find the character.
 */
export async function findCharacterObjectId(walletAddress: string): Promise<string | null> {
  const rpcUrl = CONFIG.SUI_NETWORK === 'mainnet'
    ? 'https://fullnode.mainnet.sui.io:443'
    : 'https://fullnode.testnet.sui.io:443';

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_queryEvents',
        params: [
          { MoveEventType: `${PACKAGE_ID}::character::CharacterCreated` },
          null, 50, true,
        ],
      }),
    });

    const json = await res.json() as any;
    const events = json.result?.data || [];
    for (const event of events) {
      const parsed = event.parsedJson;
      if (parsed?.owner === walletAddress) {
        return parsed.character_id;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Verify a WagerMatch object exists and check its status.
 * Returns the status: 0=waiting, 1=active, 2=settled, or null if not found.
 */
export async function getWagerStatus(wagerMatchId: string): Promise<number | null> {
  const rpcUrl = CONFIG.SUI_NETWORK === 'mainnet'
    ? 'https://fullnode.mainnet.sui.io:443'
    : 'https://fullnode.testnet.sui.io:443';

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sui_getObject',
        params: [wagerMatchId, { showContent: true }],
      }),
    });

    const json = await res.json() as any;
    const fields = json.result?.data?.content?.fields;
    if (!fields) return null;
    return Number(fields.status);
  } catch {
    return null;
  }
}
