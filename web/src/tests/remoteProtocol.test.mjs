/**
 * Ka/Ishtar protocol fixtures and 50-ply regression replay.
 * Run: node src/tests/remoteProtocol.test.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  FIFTY_PLY_HISTORY,
  replayHistoryTokens,
  kaWireMove,
  ishtarIncrementalWireMove,
  ishtarSetpositionString,
  kaSetpositionString,
  ishtarIncrementalWallRowPlusOne,
  positionKeyFromHistory,
  snapshotBoard,
} from '../lib/remoteSync.js';
import { parseAlgebraic, QuoridorBoard, toAlgebraic, WallType } from '../lib/gameLogic.js';
import { Notation } from '../lib/engineConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) passed++;
  else {
    failed++;
    console.error('  FAIL:', message);
  }
}

function assertEqual(a, b, msg) {
  assert(a === b, `${msg}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
}

console.log('\n[fixtures] Ka and Ishtar sanitized frames committed');
for (const name of ['ka_protocol.json', 'ishtar_protocol.json']) {
  const raw = JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'));
  assert(raw.frames.clientAuth.includes('token'), `${name} has auth frame`);
  assert(raw.frames.clientGo === 'go', `${name} has go frame`);
  assert(raw.frames.clientStop === 'stop', `${name} has stop frame`);
  assert(raw.frames.serverBestmove?.startsWith('bestmove') || raw.frames.serverBestmoveWall?.startsWith('bestmove'), `${name} has bestmove frame`);
}

console.log('\n[50-ply] full history replays without divergence');
const snapshots = replayHistoryTokens(FIFTY_PLY_HISTORY);
assertEqual(snapshots.length, 50, '50 snapshots');
assertEqual(snapshots[49].sideToMove, 1, 'final side to move white');
assertEqual(snapshots[0].positionKey, 'e2', 'ply1 key');

console.log('\n[50-ply] per-ply encoding and position key');
for (let i = 0; i < FIFTY_PLY_HISTORY.length; i++) {
  const token = FIFTY_PLY_HISTORY[i];
  const action = parseAlgebraic(token);
  const partial = FIFTY_PLY_HISTORY.slice(0, i + 1).map(parseAlgebraic);
  const snap = snapshots[i];
  const key = positionKeyFromHistory(partial);
  assertEqual(snap.positionKey, key, `ply ${i + 1} position key`);
  assertEqual(kaWireMove(action), token, `Ka wire ply ${i + 1}`);
  if (token.endsWith('h') || token.endsWith('v')) {
    assert(ishtarIncrementalWallRowPlusOne(action), `Ishtar row+1 ply ${i + 1} ${token}`);
  }
}

console.log('\n[encoding] Ishtar incremental f3h vs setposition convention');
const wallAction = parseAlgebraic('f3h');
assertEqual(ishtarIncrementalWireMove(wallAction), 'f4h', 'incremental wall row +1');
const board = new QuoridorBoard();
board.takeAction(parseAlgebraic('f3h'));
const engineSnap = {
  currentState: {
    playerToMove: board.playerToMove(),
    playerPositions: board._playerPositions.map((c) => ({ ...c })),
    wallsRemaining: [...board._wallsRemaining],
    wallsByPlayer: [[2, { ...wallAction.coordinate }, WallType.Horizontal]],
  },
};
const ishtarPos = ishtarSetpositionString(engineSnap);
const kaPos = kaSetpositionString(engineSnap);
assert(ishtarPos.includes('f4'), 'Ishtar setposition uses Glendenning wall coord');
assert(kaPos.includes('f3'), 'Ka setposition uses official wall coord');

console.log('\n[50-ply] terminal snapshot sanity');
const final = snapshots[49];
assert(final.wallsRemaining[0] >= 0 && final.wallsRemaining[1] >= 0, 'wall counts non-negative');
assert(final.pawnPositions.length === 2, 'two pawns');
assertEqual(
  snapshotBoard(FIFTY_PLY_HISTORY.map(parseAlgebraic)).positionKey,
  final.positionKey,
  'final snapshot matches replay',
);

console.log('\n════════════════════════════════');
console.log(`TOTAL: ${passed + failed} — passed ${passed}, failed ${failed}`);
if (failed > 0) process.exit(1);
