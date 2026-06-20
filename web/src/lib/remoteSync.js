/**
 * Remote Ka/Ishtar synchronization helpers — position keys, wire encoding, snapshots.
 */

import {
  Direction,
  QuoridorBoard,
  toAlgebraic,
  parseAlgebraic,
  transformCoordinate,
  isWallAction,
  formatCoordinate,
  WallType,
} from './gameLogic.js';
import { Notation, buildPositionString } from './engineConfig.js';

export const SyncState = {
  SYNCED: 'SYNCED',
  DESYNCED: 'DESYNCED',
};

/** Canonical move-history fingerprint (matches live search / catMovesKey). */
export function positionKeyFromHistory(actions) {
  return actions.map((action) => toAlgebraic(action)).join('|');
}

export function toEngineAlgebraic(action, notation) {
  let normalized = action;
  if (isWallAction(action) && notation === Notation.Glendenning) {
    normalized = {
      ...action,
      coordinate: transformCoordinate(action.coordinate, [Direction.Up]),
    };
  }
  return toAlgebraic(normalized);
}

export function fromEngineAlgebraic(move, notation) {
  const action = parseAlgebraic(move);
  if (isWallAction(action) && notation === Notation.Glendenning) {
    action.coordinate = transformCoordinate(action.coordinate, [Direction.Down]);
  }
  return action;
}

/** Full position snapshot for regression tests at each ply. */
export function snapshotBoard(actions) {
  const board = new QuoridorBoard();
  for (const action of actions) {
    if (!board.isValid(action)) {
      throw new Error(`illegal move ${toAlgebraic(action)} at ply ${board.actions?.length ?? actions.indexOf(action) + 1}`);
    }
    board.takeAction(action);
  }
  return {
    sideToMove: board.playerToMove(),
    pawnPositions: board._playerPositions.map((c) => ({ ...c })),
    horizontalWalls: [...board._horizontalWalls].sort(),
    verticalWalls: [...board._verticalWalls].sort(),
    wallsRemaining: [...board._wallsRemaining],
    blockedEdges: collectBlockedEdges(board),
    positionKey: positionKeyFromHistory(actions),
  };
}

function collectBlockedEdges(board) {
  const edges = [];
  for (const wall of board._horizontalWalls) {
    edges.push(`h:${wall}`);
  }
  for (const wall of board._verticalWalls) {
    edges.push(`v:${wall}`);
  }
  return edges.sort();
}

/** Ka wire token for one action. */
export function kaWireMove(action) {
  return toEngineAlgebraic(action, Notation.Official);
}

/** Ishtar incremental makemove/bestmove wire token (Glendenning walls row +1). */
export function ishtarIncrementalWireMove(action) {
  return toEngineAlgebraic(action, Notation.Glendenning);
}

/** Ishtar setposition string uses buildPositionString (full-position Glendenning convention). */
export function ishtarSetpositionString(gameSnapshot) {
  return buildPositionString(gameSnapshot, Notation.Glendenning);
}

export function kaSetpositionString(gameSnapshot) {
  return buildPositionString(gameSnapshot, Notation.Official);
}

/** Verify Ishtar incremental wall row is official row + 1. */
export function ishtarIncrementalWallRowPlusOne(action) {
  if (!isWallAction(action)) {
    return true;
  }
  const wire = ishtarIncrementalWireMove(action);
  const parsed = parseAlgebraic(wire);
  return parsed.coordinate.row === action.coordinate.row + 1;
}

export const FIFTY_PLY_HISTORY =
  'e2 e8 e3 e7 e4 e6 d3h c6h f3h e4v d5v a6h h3h e6h b3h g6h c4v f5v a1h h8h a4v h5v g5h b4h e5 e4 e6 f8h e5 d4 e4 d5 d4 d6 d5 c6 d6 b6 d5 a6 d4 a5 e4 a4 e5 a3 e6 a2 f6 b2'.split(
    /\s+/,
  );

export function replayHistoryTokens(tokens) {
  const actions = tokens.map((token) =>
    typeof token === 'string' ? parseAlgebraic(token) : token,
  );
  const snapshots = [];
  const partial = [];
  for (const action of actions) {
    partial.push(action);
    snapshots.push(snapshotBoard(partial));
  }
  return snapshots;
}
