/**
 * Sui Stack Messaging SDK shape gauntlet (Bucket 3 hotfix, 2026-05-06).
 *
 *   $ cd server && npx tsx ../scripts/qa-messaging-client.ts
 *
 * Catches SDK breakage at build time, not at first user click.
 *
 * The Tavern's encrypted DM panel relies on a specific extension
 * chain: `SuiClient → SealClient.asClientExtension → messaging`.
 * Breaking changes in any of those packages have surfaced live in
 * production already (the original bug that prompted this gauntlet:
 * `SealClient.asClientExtension is not a function` after seal 1.x
 * dropped the static method).
 *
 * Pinned version matrix (matches messaging 0.3.0's CHANGELOG):
 *   @mysten/sui      → 1.45.2  (alias: mysten-sui-v1)
 *   @mysten/seal     → 0.9.6   (alias: mysten-seal-v0)
 *   @mysten/walrus   → 0.8.6
 *   @mysten/messaging→ 0.3.0
 *
 * What this gauntlet pins:
 *   1. Each pinned dep installs at the expected major+minor.
 *   2. Aliased seal exports `SealClient.asClientExtension(...)`.
 *   3. Aliased sui exports `SuiClient` and the instance has `.$extend`.
 *   4. Top-level `@mysten/messaging` exports `messaging(...)`.
 *   5. The chain composes — `buildExtendedClient(stubSigner, address)`
 *      returns a client whose `.seal` and `.messaging` slots exist.
 *   6. `client.messaging` exposes the methods the wrapper actually
 *      calls (executeCreateChannelTransaction, executeSendMessageTransaction,
 *      getChannelMessages, getUserMemberCap, refreshSessionKey).
 *   7. `checkMessagingClientShape` reports missing methods correctly.
 *
 * Pure JS, no DB, no WS, no wallet. Constructs the client with a
 * minimal stub signer (the SDK doesn't dereference it until the first
 * tx call).
 *
 * Exits 0 on full pass, 1 on any failure.
 */

import { readFileSync } from 'fs';
import { join, resolve } from 'path';

let passes = 0;
let failures = 0;

function ok(label: string): void {
  passes++;
  console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
}
function fail(label: string, detail: string): void {
  failures++;
  console.log(`  \x1b[31mFAIL\x1b[0m ${label}\n        ${detail}`);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) ok(label);
  else fail(label, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
function truthy(v: unknown, label: string): void {
  if (v) ok(label);
  else fail(label, `expected truthy, got ${JSON.stringify(v)}`);
}
function isFn(v: unknown, label: string): void {
  if (typeof v === 'function') ok(label);
  else fail(label, `expected function, got ${typeof v}`);
}

// Resolve frontend node_modules so `node` can find the aliased
// packages even when this script runs from `server/`. We invoke this
// gauntlet from `server/` per the project convention so tsx hooks
// load cleanly; `process.cwd()` is therefore `<project>/server`.
const FRONTEND_NODE_MODULES = resolve(process.cwd(), '..', 'frontend', 'node_modules');

interface PkgVersion {
  pkg: string;
  expected: string;
  installed: string | null;
}

function readPkgVersion(pkg: string): string | null {
  try {
    const p = join(FRONTEND_NODE_MODULES, pkg, 'package.json');
    const json = JSON.parse(readFileSync(p, 'utf8'));
    return json.version ?? null;
  } catch {
    return null;
  }
}

function semverMajorMinor(v: string): string {
  const m = v.match(/^(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : v;
}

async function main(): Promise<void> {
  // ===========================================================================
  // 1 — version matrix matches messaging 0.3.0's CHANGELOG declarations
  // ===========================================================================
  console.log('\n[1] version pin — matches messaging 0.3.0 CHANGELOG');
  const expectedVersions: PkgVersion[] = [
    { pkg: 'mysten-sui-v1',     expected: '1.45', installed: readPkgVersion('mysten-sui-v1') },
    { pkg: 'mysten-seal-v0',    expected: '0.9',  installed: readPkgVersion('mysten-seal-v0') },
    { pkg: '@mysten/walrus',    expected: '0.8',  installed: readPkgVersion('@mysten/walrus') },
    { pkg: '@mysten/messaging', expected: '0.3',  installed: readPkgVersion('@mysten/messaging') },
  ];
  for (const { pkg, expected, installed } of expectedVersions) {
    if (!installed) {
      fail(`${pkg} installed`, 'package not found in frontend/node_modules');
      continue;
    }
    const got = semverMajorMinor(installed);
    if (got === expected) {
      ok(`${pkg} pinned at ${installed} (matches ${expected}.x)`);
    } else {
      fail(
        `${pkg} pinned at ${installed}`,
        `expected ${expected}.x, got ${installed} — re-pin per TAVERN_DESIGN.md version matrix`,
      );
    }
  }

  // ===========================================================================
  // 2 — aliased seal exports SealClient with static asClientExtension
  // ===========================================================================
  console.log('\n[2] mysten-seal-v0 — SealClient.asClientExtension static');
  // Resolve via the frontend node_modules path. require.resolve from
  // the project root would skip the alias.
  const sealPath = join(FRONTEND_NODE_MODULES, 'mysten-seal-v0');
  let seal: any;
  try {
    seal = require(sealPath);
    ok(`require('${sealPath}') succeeded`);
  } catch (err: any) {
    fail('require seal alias', err?.message ?? String(err));
    finalReport();
    return;
  }
  truthy(seal.SealClient, 'mysten-seal-v0 exports SealClient');
  isFn(seal.SealClient?.asClientExtension, 'SealClient.asClientExtension is a function');
  truthy(seal.SessionKey, 'mysten-seal-v0 exports SessionKey');

  // ===========================================================================
  // 3 — aliased sui exports SuiClient with $extend
  // ===========================================================================
  console.log('\n[3] mysten-sui-v1 — SuiClient + $extend');
  const suiPath = join(FRONTEND_NODE_MODULES, 'mysten-sui-v1', 'client');
  let sui: any;
  try {
    sui = require(suiPath);
    ok(`require('${suiPath}') succeeded`);
  } catch (err: any) {
    fail('require sui alias', err?.message ?? String(err));
    finalReport();
    return;
  }
  truthy(sui.SuiClient, 'mysten-sui-v1/client exports SuiClient');
  let baseClient: any;
  try {
    baseClient = new sui.SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
    ok('new SuiClient({ url }) constructs');
  } catch (err: any) {
    fail('new SuiClient', err?.message ?? String(err));
    finalReport();
    return;
  }
  isFn(baseClient.$extend, 'SuiClient instance exposes $extend');

  // ===========================================================================
  // 4 — @mysten/messaging exports messaging() factory
  // ===========================================================================
  console.log('\n[4] @mysten/messaging — exports');
  let messagingPkg: any;
  try {
    messagingPkg = require(join(FRONTEND_NODE_MODULES, '@mysten/messaging'));
    ok('require @mysten/messaging succeeded');
  } catch (err: any) {
    fail('require messaging', err?.message ?? String(err));
    finalReport();
    return;
  }
  isFn(messagingPkg.messaging, 'messaging() factory is a function');
  truthy(messagingPkg.SuiStackMessagingClient, 'SuiStackMessagingClient class is exported');
  truthy(messagingPkg.TESTNET_MESSAGING_PACKAGE_CONFIG, 'TESTNET_MESSAGING_PACKAGE_CONFIG exported');

  // ===========================================================================
  // 5 — chain composes — SuiClient → seal → messaging
  // ===========================================================================
  console.log('\n[5] extension chain composes');
  const stubSigner = {
    toSuiAddress: () => '0x0000000000000000000000000000000000000000000000000000000000000001',
    signTransaction: async () => ({ signature: '', bytes: '' }),
    signPersonalMessage: async () => ({ signature: '', bytes: '' }),
    getKeyScheme: () => 'ED25519',
    getPublicKey: () => ({ toSuiAddress: () => '0x01', toRawBytes: () => new Uint8Array(32) }),
  };
  const stubAddress = stubSigner.toSuiAddress();
  let extended: any;
  try {
    extended = baseClient
      .$extend(seal.SealClient.asClientExtension({
        serverConfigs: [
          {
            objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
            weight: 1,
          },
        ],
      }))
      .$extend(messagingPkg.messaging({
        walrusStorageConfig: {
          aggregator: 'https://aggregator.walrus-testnet.walrus.space',
          publisher: 'https://publisher.walrus-testnet.walrus.space',
          epochs: 1,
        },
        sessionKeyConfig: {
          address: stubAddress,
          ttlMin: 30,
          signer: stubSigner,
        },
      }));
    ok('chain composes without throwing');
  } catch (err: any) {
    fail('chain composes', err?.message ?? String(err));
    finalReport();
    return;
  }

  truthy(extended.seal, 'extended.seal slot present');
  truthy(extended.messaging, 'extended.messaging slot present');

  // ===========================================================================
  // 6 — methods the wrapper depends on are functions
  // ===========================================================================
  console.log('\n[6] methods the wrapper calls — present + callable');
  const mc = extended.messaging;
  isFn(mc.executeCreateChannelTransaction, 'messaging.executeCreateChannelTransaction');
  isFn(mc.executeSendMessageTransaction, 'messaging.executeSendMessageTransaction');
  isFn(mc.getChannelMessages, 'messaging.getChannelMessages');
  isFn(mc.getUserMemberCap, 'messaging.getUserMemberCap');
  isFn(mc.refreshSessionKey, 'messaging.refreshSessionKey');
  isFn(mc.getLatestMessages, 'messaging.getLatestMessages');
  isFn(mc.createChannelFlow, 'messaging.createChannelFlow');

  // ===========================================================================
  // 7 — checkMessagingClientShape reports correctly
  // ===========================================================================
  console.log('\n[7] checkMessagingClientShape — reports correctly');
  // Dynamic import via the compiled file path. The wrapper file
  // imports React-y UI types but the helper is pure.
  const wrapperPath = join(
    FRONTEND_NODE_MODULES,
    '..',
    'src',
    'lib',
    'messaging.ts',
  );
  // We can't import the .ts file directly via require — but we can
  // load tsx's hooks. Easiest: read the function body via re-import
  // through tsx, which is the runner here.
  const dynImport = await import(wrapperPath);
  const checkFn: (c: any) => string[] = dynImport.checkMessagingClientShape;
  isFn(checkFn, 'checkMessagingClientShape is exported');

  eq(checkFn(extended).length, 0, 'healthy chain → 0 missing methods');

  // Stub a busted client missing executeSendMessageTransaction
  const broken: any = {
    seal: {},
    messaging: {
      executeCreateChannelTransaction: () => {},
      // executeSendMessageTransaction missing
      getChannelMessages: () => {},
      getUserMemberCap: () => {},
      refreshSessionKey: () => {},
    },
  };
  const missingList = checkFn(broken);
  truthy(missingList.includes('messaging.executeSendMessageTransaction'),
    'missing executeSendMessageTransaction surfaces in report');

  // Stub missing seal entirely
  const noSeal: any = { messaging: broken.messaging };
  const noSealMissing = checkFn(noSeal);
  truthy(noSealMissing.includes('seal'), 'missing seal slot reported');

  // Null root
  eq(checkFn(null).length, 1, 'null client → 1 missing entry');

  // ===========================================================================
  // 8 — buildExtendedClient round-trip via the wrapper
  // ===========================================================================
  console.log('\n[8] buildExtendedClient (wrapper) round-trip');
  const builtFn = dynImport.buildExtendedClient as (s: unknown, a: string) => any;
  isFn(builtFn, 'buildExtendedClient is exported');
  const built = builtFn(stubSigner, stubAddress);
  truthy(built, 'buildExtendedClient returned a client');
  eq(checkFn(built).length, 0, 'built client passes shape check');

  // ===========================================================================
  // 9 — MVR named-package resolution wired correctly
  // ===========================================================================
  // The Sui Stack Messaging SDK's contract bindings reference its
  // package via the named placeholder `@local-pkg/sui-stack-messaging`.
  // The wrapper MUST configure the SuiClient with either an MVR
  // override or `network: 'testnet'` so the SDK can resolve that name
  // at tx-build time. The original failure mode of this gauntlet's
  // birth: `Failed to resolve package: @local-pkg/sui-stack-messaging`
  // surfaced when neither was configured. We assert both wires.
  console.log('\n[9] MVR resolution — @local-pkg → testnet package id');
  // Network must be 'testnet' so the SDK picks the testnet package
  // config and so MVR's default URL resolves correctly.
  eq(built.network, 'testnet', 'client.network === testnet');

  // The expected package id, taken from the SDK's own constants. If
  // the SDK ever bumps to a new testnet package, this will fail loudly
  // — which is what we want.
  const sdkConstants = require(join(FRONTEND_NODE_MODULES, '@mysten/messaging'));
  const expectedPackageId =
    sdkConstants.TESTNET_MESSAGING_PACKAGE_CONFIG?.packageId;
  truthy(expectedPackageId, 'SDK exports TESTNET_MESSAGING_PACKAGE_CONFIG.packageId');
  truthy(
    expectedPackageId?.startsWith('0x'),
    'package id is a 0x-prefixed object id',
  );

  // Try to resolve `@local-pkg/sui-stack-messaging` via the client's
  // MVR. If the override is wired correctly the resolution returns
  // the expected package id without a network call. We catch errors
  // and fail with a helpful message — this is the exact failure path
  // we shipped a fix for. The MVR helper lives on `client.core.mvr`
  // for the experimental sui 1.x client.
  truthy(built.core?.mvr, 'client.core.mvr present');
  try {
    const resolveResult = await built.core.mvr.resolvePackage({
      package: '@local-pkg/sui-stack-messaging',
    });
    truthy(resolveResult?.package, 'mvr.resolvePackage returned a result');
    eq(
      String(resolveResult.package).toLowerCase(),
      String(expectedPackageId).toLowerCase(),
      'resolvePackage returns expected testnet package id',
    );
  } catch (err: any) {
    fail(
      'mvr.resolvePackage(@local-pkg/sui-stack-messaging)',
      err?.message ?? String(err),
    );
  }

  // ===========================================================================
  // 10 — dapp-kit SuiGrpcClient MUST also have the MVR override
  //
  // The messaging SDK calls `signer.signAndExecuteTransaction(...)`
  // which routes the tx through dapp-kit's CurrentAccountSigner. The
  // signer internally serializes the transaction against dapp-kit's
  // OWN SuiClient (sui 2.x's SuiGrpcClient), NOT the messaging SDK's
  // bundled sui 1.x client. So if dapp-kit's client doesn't have the
  // MVR override, MVR resolution falls through to the remote registry
  // and fails closed with `Failed to resolve package` — which is
  // exactly the bug that prompted this section.
  // ===========================================================================
  console.log('\n[10] dapp-kit SuiGrpcClient MVR override');
  // Note: dapp-kit-core uses the lit-element world and isn't designed
  // to be instantiated outside a browser. We can't construct a full
  // dAppKit in node — but we CAN read the static `dapp-kit.ts` file
  // and assert it constructs SuiGrpcClient with `mvr.overrides` that
  // include the messaging package mapping. This is the cheapest
  // possible regression guard for the actual bug.
  const dappKitConfigPath = join(
    FRONTEND_NODE_MODULES,
    '..',
    'src',
    'config',
    'dapp-kit.ts',
  );
  let dappKitSrc: string;
  try {
    dappKitSrc = readFileSync(dappKitConfigPath, 'utf8');
    ok('dapp-kit config file readable');
  } catch (err: any) {
    fail('read dapp-kit.ts', err?.message ?? String(err));
    finalReport();
    return;
  }
  truthy(
    dappKitSrc.includes('@local-pkg/sui-stack-messaging'),
    'dapp-kit.ts references the messaging named package',
  );
  truthy(
    dappKitSrc.includes(String(expectedPackageId)),
    `dapp-kit.ts contains the testnet package id ${expectedPackageId?.slice(0, 14)}…`,
  );
  truthy(
    /mvr\s*:\s*\{/.test(dappKitSrc),
    'SuiGrpcClient is constructed with an mvr option',
  );
  truthy(
    dappKitSrc.includes('overrides'),
    'mvr.overrides is set on the dapp-kit client',
  );

  // Also assert that the WRAPPER's package id and dapp-kit's package
  // id are the SAME — diverging values is what would re-introduce the
  // bug in a future refactor.
  const wrapperSrcPath = join(
    FRONTEND_NODE_MODULES,
    '..',
    'src',
    'lib',
    'messaging.ts',
  );
  const wrapperSrc = readFileSync(wrapperSrcPath, 'utf8');
  // The package id appears at least once in each file; assert the
  // exact same hex string is in both.
  truthy(
    wrapperSrc.includes(String(expectedPackageId)),
    'messaging.ts contains the same testnet package id',
  );

  // ===========================================================================
  // 11 — withTimeout wrapper rejects on stalled SDK calls (Bug 1
  //      regression guard, 2026-05-06 hotfix #4)
  //
  // The Sui Stack Messaging SDK has been observed to hang silently:
  // the wallet popup completes, the on-chain tx lands, but the JS
  // promise returned by `executeCreateChannelTransaction` /
  // `executeSendMessageTransaction` never settles. Pre-fix, the DM
  // panel stuck in "Signing…" with no error toast — the user's only
  // recovery was a page reload. The wrapper now wraps every SDK call
  // in `withTimeout(...)` which rejects after a fixed budget so the
  // calling component's catch+finally always runs.
  //
  // This section validates:
  //   • the helper rejects within ms+slack on a never-resolving promise
  //   • the rejection error message names the labelled call
  //   • a fast-resolving promise still bubbles its value through
  //   • a fast-rejecting promise's error is preserved
  //   • `SDK_TIMEOUT_MS` exposes budgets for every wrapped call
  // ===========================================================================
  console.log('\n[11] withTimeout — stalled-SDK regression guard');
  const { withTimeout, SDK_TIMEOUT_MS } = await import(wrapperSrcPath);
  isFn(withTimeout, 'withTimeout is exported');
  truthy(SDK_TIMEOUT_MS, 'SDK_TIMEOUT_MS budgets exported');
  // Every wrapped call has an entry in the budget table — keeps a
  // future contributor from adding a new SDK call without picking a
  // timeout.
  const expectedBudgets = [
    'createChannel',
    'sendMessage',
    'getMessages',
    'resolveCap',
    'refreshSession',
  ];
  for (const k of expectedBudgets) {
    truthy(
      typeof SDK_TIMEOUT_MS[k] === 'number' && SDK_TIMEOUT_MS[k] > 0,
      `SDK_TIMEOUT_MS.${k} is a positive number`,
    );
  }

  // Hanging promise → wrapper rejects within budget+slack.
  const startStall = Date.now();
  const stallBudget = 80; // ms — short for a fast test
  let stallErr: Error | null = null;
  try {
    await withTimeout(
      new Promise(() => {}), // never resolves
      stallBudget,
      'fakeStalledCall',
    );
    fail('withTimeout(stalled)', 'expected rejection but resolved');
  } catch (err: any) {
    stallErr = err;
  }
  const stallElapsed = Date.now() - startStall;
  truthy(stallErr instanceof Error, 'withTimeout rejects with an Error');
  truthy(
    stallErr && /fakeStalledCall/.test(stallErr.message),
    'rejection message names the labelled call',
  );
  truthy(
    stallErr && /timed out/.test(stallErr.message),
    'rejection message says "timed out"',
  );
  truthy(
    stallElapsed >= stallBudget && stallElapsed < stallBudget + 1000,
    `rejection fires near the budget (got ${stallElapsed}ms, budget ${stallBudget}ms)`,
  );

  // Fast resolve passes the value through.
  const fastResolved = await withTimeout(Promise.resolve(42), 50, 'fastResolve');
  eq(fastResolved, 42, 'fast resolve returns the original value');

  // Fast reject preserves the original error (not the timeout error).
  let preservedErr: Error | null = null;
  try {
    await withTimeout(
      Promise.reject(new Error('original SDK error')),
      50,
      'fastReject',
    );
  } catch (err: any) {
    preservedErr = err;
  }
  truthy(preservedErr instanceof Error, 'fast reject still rejects');
  truthy(
    preservedErr && /original SDK error/.test(preservedErr.message),
    'original SDK error message preserved (not replaced by timeout error)',
  );

  // Belt-and-braces: the wrapper imports use the helper. Rather than
  // mock the SDK, assert at source level that every public wrapper
  // function references `withTimeout(`. This catches the case where
  // the helper exists but a future contributor forgot to wrap a new
  // SDK call — which is exactly the failure shape that shipped the
  // original bug.
  const sdkCallSites = [
    'executeCreateChannelTransaction',
    'executeSendMessageTransaction',
    'getChannelMessages',
    'getUserMemberCap',
    'refreshSessionKey',
  ];
  for (const fn of sdkCallSites) {
    // Look for the SDK method call on the same line OR within ~5
    // lines after a `withTimeout(` opener — works for both styles.
    const pattern = new RegExp(
      `withTimeout\\([^)]*${fn}|${fn}[\\s\\S]{0,200}withTimeout`,
      'm',
    );
    truthy(
      pattern.test(wrapperSrc),
      `messaging.ts wraps ${fn} in withTimeout`,
    );
  }

  finalReport();
}

function finalReport(): void {
  console.log(`\n✓ Passed: ${passes}`);
  if (failures > 0) {
    console.log(`✗ Failed: ${failures}`);
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('UNCAUGHT', err);
  process.exit(1);
});
