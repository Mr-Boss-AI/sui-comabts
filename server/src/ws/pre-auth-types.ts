/**
 * Pre-auth WS message-type whitelist.
 *
 * Lives in its own module so the QA gauntlet (`qa-spectator-guest-flow.ts`)
 * can import the canonical set without dragging in `config.ts`, which
 * requires a fully-populated `.env` and would otherwise force the
 * gauntlet to run with real testnet credentials configured.
 *
 * Three buckets:
 *   1. Auth handshake — `auth_request`, `auth_signature`, `auth_token`.
 *   2. Legacy bare `auth` — rejected with guidance, but routed so the
 *      client gets an instructive error rather than a generic one.
 *   3. Guest spectator (Bug 2 fix, 2026-05-18) — `spectate_fight`,
 *      `stop_spectating` are read-only fight observation; admitting them
 *      pre-auth lets a disconnected user click "Watch a Fight" from the
 *      landing screen and watch live combat without ever connecting a
 *      wallet. The spectator key falls back to `guest:${client.id}` when
 *      `client.walletAddress` is unset (see handler.ts::handleSpectateFight).
 */
export const PRE_AUTH_TYPES: ReadonlySet<string> = new Set([
  'auth_request',
  'auth_signature',
  'auth_token',
  'auth', // legacy; rejected with guidance
  'spectate_fight',
  'stop_spectating',
]);
