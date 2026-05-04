"use client";

import { useState } from "react";
import { useGame } from "@/hooks/useGameStore";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { Navbar } from "./navbar";
import { TownNav } from "./town-hub";
import { CharacterCreation } from "@/components/character/character-creation";
import type { AuthPhase } from "@/hooks/useGameStore";
import { CharacterProfile } from "@/components/character/character-profile";
import { FightArena } from "@/components/fight/fight-arena";
import { MatchmakingQueue } from "@/components/fight/matchmaking-queue";
import { SpectateView } from "@/components/fight/spectate-view";
import { Inventory } from "@/components/items/inventory";
import { ChatPanel } from "@/components/social/chat-panel";
import { PlayerList } from "@/components/social/player-list";
import { ChallengePopup } from "@/components/social/challenge-popup";
import { Leaderboard } from "@/components/social/leaderboard";
import { FightHistory } from "@/components/social/fight-history";
import { MarketplaceBrowser } from "@/components/marketplace/marketplace-browser";
import { MyKioskPanel } from "@/components/marketplace/my-kiosk-panel";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorToast } from "@/components/ui/error-toast";
import { LevelUpModal } from "@/components/character/level-up-modal";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

/**
 * Pre-character gating UI. Render only when `state.character` is null — once
 * the server confirms a character, the game UI takes over. Closes layer 1 of
 * the 2026-04-30 duplicate-mint bug: <CharacterCreation /> is never rendered
 * as a fallback during the auth-flicker window; it shows up only after the
 * chain check has DEFINITIVELY returned no character.
 */
function PreCharacterGate({
  phase,
  onRetry,
}: {
  phase: AuthPhase;
  onRetry: () => void;
}) {
  if (phase === "no_character") {
    return <CharacterCreation />;
  }
  if (phase === "chain_check_failed") {
    return (
      <div className="flex flex-col items-center justify-center flex-1 p-6 text-center gap-4">
        <div className="text-3xl">⚠️</div>
        <h2 className="text-xl font-bold text-zinc-100">Couldn&apos;t reach the Sui network</h2>
        <p className="text-sm text-zinc-400 max-w-md">
          We need to check whether this wallet already has a fighter on chain
          before we can show you the create screen. The RPC node didn&apos;t
          answer.
        </p>
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
        <p className="text-xs text-zinc-600 max-w-md">
          If this keeps happening, your network blocks Sui&apos;s public
          fullnode or the testnet RPC is degraded. Check
          <code className="mx-1 px-1 py-0.5 bg-zinc-800 rounded text-zinc-400">
            fullnode.testnet.sui.io
          </code>
          and refresh.
        </p>
      </div>
    );
  }
  // "auth_pending" or "chain_check_pending" — both render the same neutral
  // loading screen. Distinguishing them in copy doesn't help the user; what
  // matters is that the create form is not rendered.
  const message =
    phase === "auth_pending"
      ? "Signing you in…"
      : "Checking the chain for your fighter…";
  return (
    <div className="flex flex-col items-center justify-center flex-1 p-6 gap-4">
      <div className="h-10 w-10 rounded-full border-2 border-zinc-700 border-t-emerald-400 animate-spin" />
      <p className="text-sm text-zinc-400">{message}</p>
    </div>
  );
}

function HowToPlayButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        ? How to Play
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="How to Play" wide>
        <div className="space-y-5 text-sm text-zinc-300">
          <div>
            <h3 className="text-base font-bold text-zinc-100 mb-2">The 5-Zone System</h3>
            <p className="mb-2">Each fighter&apos;s body is divided into 5 hit zones, from top to bottom:</p>
            <div className="grid grid-cols-5 gap-1 text-center text-xs font-bold mb-3">
              {["Head", "Chest", "Stomach", "Belt", "Legs"].map((z) => (
                <div key={z} className="bg-zinc-800 border border-zinc-700 rounded py-2">{z}</div>
              ))}
            </div>
            <p>Each turn you choose zones to <span className="text-red-400 font-semibold">attack</span> and zones to <span className="text-blue-400 font-semibold">block</span>. If your attack hits a blocked zone, it deals no damage.</p>
          </div>

          <div>
            <h3 className="text-base font-bold text-zinc-100 mb-2">Block Coverage</h3>
            <ul className="space-y-1 text-zinc-400">
              <li><span className="text-zinc-200 font-semibold">Regular weapon:</span> Blocks 2 adjacent zones (circular &mdash; Legs wraps to Head)</li>
              <li><span className="text-zinc-200 font-semibold">Shield:</span> Blocks 3 adjacent zones (also circular)</li>
              <li><span className="text-zinc-200 font-semibold">Dual wield:</span> Blocks 1 zone, but attacks 2 zones</li>
            </ul>
          </div>

          <div>
            <h3 className="text-base font-bold text-zinc-100 mb-2">Stat Counters</h3>
            <p className="mb-2">Stats form a rock-paper-scissors triangle:</p>
            <div className="flex items-center justify-center gap-2 text-sm font-bold py-3">
              <span className="text-amber-400 bg-amber-400/10 px-3 py-1.5 rounded">Tank (END)</span>
              <span className="text-zinc-500">&gt;</span>
              <span className="text-cyan-400 bg-cyan-400/10 px-3 py-1.5 rounded">Evasion (DEX)</span>
              <span className="text-zinc-500">&gt;</span>
              <span className="text-purple-400 bg-purple-400/10 px-3 py-1.5 rounded">Crit (INT)</span>
              <span className="text-zinc-500">&gt;</span>
              <span className="text-amber-400 bg-amber-400/10 px-3 py-1.5 rounded">Tank</span>
            </div>
            <ul className="space-y-1 text-zinc-400 text-xs">
              <li><span className="text-amber-400">Endurance</span> reduces crit chance and provides defense &mdash; counters Crit builds</li>
              <li><span className="text-cyan-400">Dexterity</span> grants evasion to dodge hits entirely &mdash; counters Tank builds</li>
              <li><span className="text-purple-400">Intuition</span> grants crit chance for burst damage &mdash; counters Evasion builds</li>
              <li><span className="text-red-400">Strength</span> adds raw damage and anti-evasion &mdash; universal but no specialty</li>
            </ul>
          </div>
        </div>
      </Modal>
    </>
  );
}

function ResetCharacterButton() {
  const { state } = useGame();
  const [confirming, setConfirming] = useState(false);

  function handleReset() {
    state.socket.send({ type: "delete_character" });
    setConfirming(false);
  }

  if (confirming) {
    return (
      <div className="rounded border border-red-900/40 bg-red-950/20 p-3 space-y-2">
        <p className="text-xs text-red-300">This will delete your character and let you create a new one under the current on-chain package. Your old character data will be lost.</p>
        <div className="flex gap-2">
          <Button variant="danger" size="sm" onClick={handleReset}>Confirm Reset</Button>
          <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="w-full text-xs text-zinc-600 hover:text-red-400 transition-colors py-2"
    >
      Reset Character (migrate to current package)
    </button>
  );
}

function AreaContent() {
  const { state } = useGame();
  const { currentArea, character } = state;

  if (!character) return null;

  switch (currentArea) {
    case "character":
      return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <CharacterProfile character={character} />
            <FightHistory />
          </div>
          <div className="space-y-4">
            <Inventory />
            <ResetCharacterButton />
          </div>
        </div>
      );
    case "arena":
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div />
            <HowToPlayButton />
          </div>
          <MatchmakingQueue />
        </div>
      );
    case "marketplace":
      return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <MarketplaceBrowser />
          </div>
          <div className="space-y-4">
            <MyKioskPanel />
            <Inventory />
          </div>
        </div>
      );
    case "tavern":
      return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <Card className="h-[500px] flex flex-col">
              <CardHeader>
                <span className="font-semibold">Tavern Chat</span>
              </CardHeader>
              <CardBody className="flex-1 p-0 min-h-0">
                <ChatPanel />
              </CardBody>
            </Card>
          </div>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <span className="font-semibold">Players</span>
              </CardHeader>
              <CardBody>
                <PlayerList />
              </CardBody>
            </Card>
          </div>
        </div>
      );
    case "hall_of_fame":
      return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <Leaderboard />
          </div>
          <div />
        </div>
      );
    default:
      return null;
  }
}

export function GameScreen() {
  const account = useCurrentAccount();
  const { state, dispatch } = useGame();
  const { character, fight, spectatingFight, authPhase } = state;

  // Not connected
  if (!account) {
    return (
      <div className="flex flex-col flex-1">
        <Navbar />
        <ErrorToast />
        <div className="flex flex-col flex-1 items-center justify-center gap-8 p-4">
          <div className="text-center">
            <h1 className="text-5xl font-black tracking-tight mb-3">
              SUI<span className="text-emerald-400">Combats</span>
            </h1>
            <p className="text-zinc-400 text-lg max-w-md mx-auto">
              A blockchain PvP arena — connect your wallet, create a fighter,
              gear up, and battle for SUI.
            </p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-zinc-500">Connect your Sui wallet to begin</p>
          </div>
        </div>
      </div>
    );
  }

  // In a fight
  if (fight && fight.status === "active") {
    return (
      <div className="flex flex-col flex-1">
        <Navbar />
        <ErrorToast />
        <FightArena />
        <ChallengePopup />
      </div>
    );
  }

  // Fight just ended (showing results)
  if (fight && fight.status === "finished") {
    return (
      <div className="flex flex-col flex-1">
        <Navbar />
        <ErrorToast />
        <FightArena />
      </div>
    );
  }

  // Spectating
  if (spectatingFight) {
    return (
      <div className="flex flex-col flex-1">
        <Navbar />
        <ErrorToast />
        <SpectateView />
      </div>
    );
  }

  // No character yet — gate via the explicit auth-phase state machine.
  // CharacterCreation is reachable only when authPhase === "no_character",
  // i.e. the chain check has DEFINITIVELY confirmed the wallet has no
  // existing Character NFT. See game-provider.tsx for the transitions.
  if (!character) {
    return (
      <div className="flex flex-col flex-1">
        <Navbar />
        <ErrorToast />
        <PreCharacterGate
          phase={authPhase}
          onRetry={() =>
            dispatch({ type: "SET_AUTH_PHASE", phase: "chain_check_pending" })
          }
        />
      </div>
    );
  }

  // Main game view
  return (
    <div className="flex flex-col flex-1">
      <Navbar />
      <ErrorToast />
      <LevelUpModal />
      <div className="max-w-7xl mx-auto w-full px-4 py-4 space-y-3">
        <div className="bg-amber-900/30 border border-amber-700/40 rounded-lg px-4 py-2 text-xs text-amber-300/80 text-center">
          Testnet demo — characters and items reset on server restart
        </div>
        <TownNav />
        <AreaContent />
      </div>
      <ChallengePopup />
    </div>
  );
}
