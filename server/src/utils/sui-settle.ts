import { execSync } from 'child_process';
import { CONFIG } from '../config';

const PACKAGE_ID = CONFIG.SUI_PACKAGE_ID;

/**
 * Call settle_wager on-chain. The winner gets 95%, treasury gets 5%.
 * Uses the local sui CLI which must have a configured wallet.
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
      `--args ${wagerMatchId} ${winnerAddress} '[]'`,
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
