/**
 * Remote engine synchronization state machine tests.
 * Run: node src/tests/remoteSync.test.mjs
 */

import {
  EngineClient,
  MockWebSocket,
  _mockSockets,
} from '../lib/engineClient.js';
import { SyncState, positionKeyFromHistory } from '../lib/remoteSync.js';
import { PlayerType, TimeToMove, getEngineList } from '../lib/engineConfig.js';
import { parseAlgebraic } from '../lib/gameLogic.js';

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

function kaConfig() {
  return getEngineList().find((e) => e.key === PlayerType.KaAI);
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function openClient() {
  _mockSockets.length = 0;
  const config = kaConfig();
  const client = new EngineClient(config, { webSocketFactory: (uri) => new MockWebSocket(uri) });
  client.connect();
  await flushMicrotasks();
  const ws = _mockSockets[0];
  ws.simulateOpen();
  await flushMicrotasks();
  return { client, ws };
}

console.log('\n[sync] own move echoed before next go');
{
  const { client, ws } = await openClient();
  const moves = [parseAlgebraic('e2')];
  const key = positionKeyFromHistory(moves);
  client.updateLocalExpectations(moves, key);
  await client.syncGameState({ moveHistory: moves, isFreshGame: false, positionKey: key });
  await flushMicrotasks();
  assert(ws.sent.some((s) => s === 'makemove e2'), 'initial makemove e2');
  assertEqual(client.appliedPlies, 1, 'appliedPlies after sync');
  assertEqual(client.syncState, SyncState.SYNCED, 'synced after replay');

  await client.echoCommittedMove(parseAlgebraic('e3'), 'e2|e3', 2);
  await flushMicrotasks();
  assert(ws.sent.filter((s) => s.startsWith('makemove e3')).length === 1, 'echo e3 once');

  client.updateLocalExpectations(moves.concat(parseAlgebraic('e3')), 'e2|e3');
  client.appliedPlies = 2;
  client.appliedPositionKey = 'e2|e3';
  client.go(TimeToMove.Short);
  await flushMicrotasks();
  assert(ws.sent.includes('go'), 'go after echo');
}

console.log('\n[sync] no duplicate ply echo');
{
  const { client } = await openClient();
  const key = 'e2|e3';
  client.appliedPlies = 2;
  client.appliedPositionKey = key;
  client.syncState = SyncState.SYNCED;
  const before = _mockSockets[0].sent.length;
  await client.echoCommittedMove(parseAlgebraic('e3'), key, 2);
  await flushMicrotasks();
  assertEqual(_mockSockets[0].sent.length, before, 'no send on duplicate echo');
}

console.log('\n[sync] partial failure enters DESYNCED');
{
  const { client } = await openClient();
  client.appliedPlies = 0;
  client.syncState = SyncState.SYNCED;
  let rejected = false;
  try {
    await client.echoCommittedMove(parseAlgebraic('e3'), 'e3', 2);
  } catch {
    rejected = true;
  }
  assert(rejected, 'gap echo rejected');
  assertEqual(client.syncState, SyncState.DESYNCED, 'DESYNCED after gap');
  assertEqual(client.appliedPlies, 0, 'appliedPlies not blindly reset');
}

console.log('\n[sync] reconnect restores exact state');
{
  const { client, ws } = await openClient();
  const moves = [parseAlgebraic('e2'), parseAlgebraic('e8')];
  const key = positionKeyFromHistory(moves);
  client.markDesynced('test desync');
  await client.recoverFromDesync({ moveHistory: moves, isFreshGame: false, positionKey: key });
  await flushMicrotasks();
  assertEqual(client.syncState, SyncState.SYNCED, 'resynced');
  assertEqual(client.appliedPlies, 2, 'applied plies restored');
  assertEqual(client.appliedPositionKey, key, 'position key restored');
  assert(ws.sent.includes('makemove e2 e8') || ws.sent.filter((s) => s.startsWith('makemove')).length >= 2, 'makemove replay');
}

console.log('\n[sync] old connection callbacks ignored');
{
  const { client, ws } = await openClient();
  const epoch = client.connectionEpoch;
  let infoCount = 0;
  client.onInfo = () => { infoCount += 1; };
  client.connectionEpoch += 1;
  ws.simulateMessage('info depth 1 score 0.5 visits 1 pv e3');
  assertEqual(infoCount, 0, 'stale epoch info ignored');
  assert(epoch !== client.connectionEpoch, 'epoch bumped');
}

console.log('\n[sync] bestmove does not advance appliedPlies');
{
  const { client, ws } = await openClient();
  client.appliedPlies = 1;
  client.appliedPositionKey = 'e2';
  client.updateLocalExpectations([parseAlgebraic('e2')], 'e2');
  client.activeRequestSeq = 3;
  ws.simulateMessage('bestmove e3');
  await flushMicrotasks();
  assertEqual(client.appliedPlies, 1, 'bestmove leaves appliedPlies');
}

console.log('\n[sync] go blocked when DESYNCED');
{
  const { client } = await openClient();
  client.syncState = SyncState.DESYNCED;
  client.appliedPlies = 0;
  client._localHistoryLength = 0;
  client._localPositionKey = '';
  client.appliedPositionKey = '';
  let threw = false;
  try {
    client.go(TimeToMove.Short);
  } catch {
    threw = true;
  }
  assert(threw, 'go throws when desynced');
}

console.log('\n════════════════════════════════');
console.log(`TOTAL: ${passed + failed} — passed ${passed}, failed ${failed}`);
if (failed > 0) process.exit(1);
