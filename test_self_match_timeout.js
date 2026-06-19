'use strict';

const assert = require('assert');

const {
  Engine,
  deriveEngineCommandTimeoutMs,
  formatEnginePhaseTimeout,
} = require('./self_match');

assert.strictEqual(deriveEngineCommandTimeoutMs(1, 'ready'), 30_000);
assert.strictEqual(deriveEngineCommandTimeoutMs(1, 'go'), 30_000);
assert.strictEqual(deriveEngineCommandTimeoutMs(5, 'go'), 35_000);
assert.strictEqual(deriveEngineCommandTimeoutMs(10, 'go'), 50_000);
assert.strictEqual(deriveEngineCommandTimeoutMs(30, 'go'), 90_000);

const decorated = formatEnginePhaseTimeout(new Error('engine read timeout (50000ms)'), {
  timeoutMs: 50_000,
  engine: 'titanium-v15',
  phase: 'go',
  tcSec: 10,
  ply: 42,
  elapsedMs: 50_123,
  pid: 777,
  exitCode: null,
  killed: true,
});
assert.match(decorated.message, /engine read timeout \(50000ms\)/);
assert.match(decorated.message, /engine=titanium-v15/);
assert.match(decorated.message, /phase=go/);
assert.match(decorated.message, /tc=10s/);
assert.match(decorated.message, /ply=42/);
assert.match(decorated.message, /killed=yes/);

async function testBestMoveTimeoutCleanup() {
  let killed = false;
  let sent = [];
  const fake = Object.create(Engine.prototype);
  fake.flag = 'titanium-v15';
  fake.spawnError = null;
  fake.proc = {
    pid: 1234,
    exitCode: null,
    kill() { killed = true; this.exitCode = 1; },
  };
  fake.stderrLines = [];
  fake._send = (cmd) => { sent.push(cmd); };
  fake._moveTimeoutMs = Engine.prototype._moveTimeoutMs;
  let calls = 0;
  fake._awaitAny = async () => {
    calls += 1;
    if (calls === 1) return 'ready';
    throw new Error(`engine read timeout (${deriveEngineCommandTimeoutMs(10, 'go')}ms)`);
  };

  await assert.rejects(
    () => Engine.prototype._bestMoveImpl.call(fake, ['e2', 'e8'], 10),
    (err) => {
      assert.match(err.message, /engine read timeout \(50000ms\)/);
      assert.match(err.message, /phase=go/);
      assert.match(err.message, /ply=2/);
      return true;
    },
  );
  assert.strictEqual(killed, true);
  assert.deepStrictEqual(sent, ['position e2 e8', 'go 10', 'quit']);
}

testBestMoveTimeoutCleanup()
  .then(() => console.log('self_match timeout tests: PASS'))
  .catch((err) => {
    console.error(err.stack || err);
    process.exit(1);
  });
