import { GAME_CONSTANTS } from '../config';
import type { FightType, QueueEntry } from '../types';

// === Matchmaking Queue ===

class MatchmakingQueue {
  private queue: QueueEntry[] = [];
  private matchCheckInterval: ReturnType<typeof setInterval> | null = null;
  private onMatchFound: (entryA: QueueEntry, entryB: QueueEntry) => void;

  constructor(onMatchFound: (entryA: QueueEntry, entryB: QueueEntry) => void) {
    this.onMatchFound = onMatchFound;
  }

  start(): void {
    if (this.matchCheckInterval) return;
    this.matchCheckInterval = setInterval(() => {
      this.tryMatchPlayers();
    }, 2000);
  }

  stop(): void {
    if (this.matchCheckInterval) {
      clearInterval(this.matchCheckInterval);
      this.matchCheckInterval = null;
    }
  }

  addToQueue(entry: QueueEntry): boolean {
    // Check if player is already in queue
    const existing = this.queue.find((e) => e.walletAddress === entry.walletAddress);
    if (existing) {
      return false;
    }
    this.queue.push(entry);
    // Immediately try to match
    this.tryMatchPlayers();
    return true;
  }

  removeFromQueue(walletAddress: string): QueueEntry | null {
    const idx = this.queue.findIndex((e) => e.walletAddress === walletAddress);
    if (idx === -1) return null;
    return this.queue.splice(idx, 1)[0];
  }

  isInQueue(walletAddress: string): boolean {
    return this.queue.some((e) => e.walletAddress === walletAddress);
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getQueueSizeByType(fightType: FightType): number {
    return this.queue.filter((e) => e.fightType === fightType).length;
  }

  private tryMatchPlayers(): void {
    const now = Date.now();
    const matched = new Set<string>();

    // Group by fight type
    const byType = new Map<FightType, QueueEntry[]>();
    for (const entry of this.queue) {
      if (matched.has(entry.walletAddress)) continue;
      const list = byType.get(entry.fightType) || [];
      list.push(entry);
      byType.set(entry.fightType, list);
    }

    for (const [fightType, entries] of byType) {
      if (entries.length < 2) continue;

      for (let i = 0; i < entries.length; i++) {
        if (matched.has(entries[i].walletAddress)) continue;
        const entryA = entries[i];

        for (let j = i + 1; j < entries.length; j++) {
          if (matched.has(entries[j].walletAddress)) continue;
          const entryB = entries[j];

          if (this.canMatch(entryA, entryB, fightType, now)) {
            matched.add(entryA.walletAddress);
            matched.add(entryB.walletAddress);
            this.onMatchFound(entryA, entryB);
            break;
          }
        }
      }
    }

    // Remove matched players from queue
    if (matched.size > 0) {
      this.queue = this.queue.filter((e) => !matched.has(e.walletAddress));
    }
  }

  private canMatch(a: QueueEntry, b: QueueEntry, fightType: FightType, now: number): boolean {
    // Must be same fight type
    if (a.fightType !== b.fightType) return false;

    // For wager fights, amounts must match
    if (fightType === 'wager') {
      if (a.wagerAmount !== b.wagerAmount) return false;
    }

    // For friendly fights, match anyone
    if (fightType === 'friendly') return true;

    // For ranked/wager, check rating range
    const ratingDiff = Math.abs(a.rating - b.rating);

    // Calculate expanded range based on time in queue
    const timeInQueueA = now - a.joinedAt;
    const timeInQueueB = now - b.joinedAt;
    const maxTimeInQueue = Math.max(timeInQueueA, timeInQueueB);

    const expansions = Math.floor(maxTimeInQueue / GAME_CONSTANTS.MATCHMAKING_EXPAND_INTERVAL_MS);
    const allowedRange =
      GAME_CONSTANTS.MATCHMAKING_INITIAL_RANGE + expansions * GAME_CONSTANTS.MATCHMAKING_EXPAND_AMOUNT;

    return ratingDiff <= allowedRange;
  }
}

// Singleton instance - will be initialized with callback in index.ts
let matchmakingInstance: MatchmakingQueue | null = null;

export function initMatchmaking(onMatchFound: (a: QueueEntry, b: QueueEntry) => void): MatchmakingQueue {
  matchmakingInstance = new MatchmakingQueue(onMatchFound);
  matchmakingInstance.start();
  return matchmakingInstance;
}

export function getMatchmaking(): MatchmakingQueue {
  if (!matchmakingInstance) {
    throw new Error('Matchmaking not initialized. Call initMatchmaking first.');
  }
  return matchmakingInstance;
}

export function shutdownMatchmaking(): void {
  if (matchmakingInstance) {
    matchmakingInstance.stop();
    matchmakingInstance = null;
  }
}
