'use strict';

const assert = require('assert');
global.WebSocket = { OPEN: 1, CONNECTING: 0 };

const { QuoridorEngineClient, ENGINES } = require('./extracted/engine_client');
const { isCompleteGame } = require('./game_validate');

function exactCommands(visits) {
  const sent = [];
  const client = new QuoridorEngineClient(ENGINES.ka);
  client.ws = { readyState: WebSocket.OPEN, send: (line) => sent.push(line) };
  client.goExact(visits, 'intuition');
  return sent;
}

for (const visits of [1, 51, 12_345, 1_000_000]) {
  assert.deepStrictEqual(exactCommands(visits), [
    `setoption name visits value ${visits}`,
    'go',
  ]);
}

assert.throws(() => exactCommands(Number.NaN), /invalid exact visit budget/);
assert.strictEqual(isCompleteGame({ winner: 1, plies: 8, moves: Array(8).fill('e2') }), true);
assert.strictEqual(isCompleteGame({ winner: 0, incomplete: true, plies: 300 }), false);

console.log('adaptive pipeline JS tests: PASS');
