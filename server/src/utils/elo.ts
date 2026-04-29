import { GAME_CONSTANTS } from '../config';
import type { FightType } from '../types';

/**
 * Standard ELO rating calculation.
 * K-factor = 32, minimum rating = 100.
 */

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function calculateEloChange(
  winnerRating: number,
  loserRating: number
): { winnerNew: number; loserNew: number; winnerDelta: number; loserDelta: number } {
  const K = GAME_CONSTANTS.ELO_K_FACTOR;
  const MIN = GAME_CONSTANTS.ELO_MIN_RATING;

  const expectedWinner = expectedScore(winnerRating, loserRating);
  const expectedLoser = expectedScore(loserRating, winnerRating);

  const winnerDelta = Math.round(K * (1 - expectedWinner));
  const loserDelta = Math.round(K * (0 - expectedLoser));

  const winnerNew = Math.max(MIN, winnerRating + winnerDelta);
  const loserNew = Math.max(MIN, loserRating + loserDelta);

  return {
    winnerNew,
    loserNew,
    winnerDelta,
    loserDelta,
  };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * GDD §9.2 reward bands. Hard-capped at chain `MAX_XP_PER_FIGHT` so we never
 * trigger the chain abort `EXpTooHigh = 1`.
 *
 *   Win ranked  : clamp(50 + (oppRating - myRating)/10, 50, 200)
 *   Loss ranked : randomInt(10, 30)
 *   Win wager   : clamp(100 + (oppRating - myRating)/5, 100, 400)
 *   Loss wager  : randomInt(20, 50)
 *   Friendly    : zero (no progression — friendly is for practice).
 *
 * Underdog wins → upper end of the win band (positive ratingDiff).
 * Heavy-favorite wins → floor (the GDD intentionally floors at the base value
 * rather than going lower so a win is always meaningfully rewarded).
 */
export function calculateXpReward(
  fightType: FightType,
  isWinner: boolean,
  winnerRating: number,
  loserRating: number,
): number {
  const ratingDiff = isWinner
    ? loserRating - winnerRating   // positive = winner was the underdog
    : winnerRating - loserRating;  // positive = loser fought "up"

  let reward = 0;

  switch (fightType) {
    case 'wager': {
      if (isWinner) {
        reward = clamp(
          GAME_CONSTANTS.XP_WAGER_WIN_BASE + ratingDiff / GAME_CONSTANTS.XP_WAGER_WIN_RATING_DIVISOR,
          GAME_CONSTANTS.XP_WAGER_WIN_MIN,
          GAME_CONSTANTS.XP_WAGER_WIN_MAX,
        );
      } else {
        reward = randomInt(GAME_CONSTANTS.XP_WAGER_LOSS_MIN, GAME_CONSTANTS.XP_WAGER_LOSS_MAX);
      }
      break;
    }
    case 'ranked':
    case 'item_stake': {
      // Item-stake fights run the ranked progression curve — same blast radius,
      // different escrow shape. Friendly is a separate explicit zero below.
      if (isWinner) {
        reward = clamp(
          GAME_CONSTANTS.XP_RANKED_WIN_BASE + ratingDiff / GAME_CONSTANTS.XP_RANKED_WIN_RATING_DIVISOR,
          GAME_CONSTANTS.XP_RANKED_WIN_MIN,
          GAME_CONSTANTS.XP_RANKED_WIN_MAX,
        );
      } else {
        reward = randomInt(GAME_CONSTANTS.XP_RANKED_LOSS_MIN, GAME_CONSTANTS.XP_RANKED_LOSS_MAX);
      }
      break;
    }
    case 'friendly':
    default: {
      // No progression for practice fights — design intent.
      reward = 0;
      break;
    }
  }

  // Final hard cap — chain enforces MAX_XP_PER_FIGHT = 1000. Round to integer
  // since chain accepts u64 and fractional XP would surprise readers.
  return Math.max(0, Math.min(GAME_CONSTANTS.MAX_XP_PER_FIGHT, Math.round(reward)));
}
