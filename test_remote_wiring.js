#!/usr/bin/env node
/**
 * Probe Ka + Ishtar at every preset — verify WebSocket wiring and measure think time.
 * Usage: node site/test_remote_wiring.js [--moves N]
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { REMOTE_TIME_MODES, timeLabel, normalizeTimeMode } = require('./remote_presets');
const { QuoridorEngineClient, ENGINES } = require('./extracted/engine_client');

const MODES = REMOTE_TIME_MODES;
const OPPONENTS = ['ka', 'ishtar'];
const OUT = path.resolve(__dirname, '../training/data/remote_timing.json');

/** Quick handshake — fails fast if HTTP upgrade rejected (Ishtar-v3 often down). */
function connectHealth(opp) {
  return new Promise((resolve) => {
    const uri = ENGINES[opp].uri;
    const ws = new WebSocket(uri);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, uri, error: 'connect timeout 15s' }), 15_000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ token: 'rbt_token_*', version: '0.0.0' }));
      clearTimeout(timer);
      finish({ ok: true, uri });
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      finish({ ok: false, uri, error: 'WebSocket upgrade failed' });
    });
    ws.addEventListener('close', (e) => {
      if (!settled) {
        clearTimeout(timer);
        finish({ ok: false, uri, error: `closed ${e.code}` });
      }
    });
  });
}

function emptyBoardState() {
  return {
    playerToMove: 1,
    moveNumber: 1,
    wallsRemaining: [10, 10],
    playerPositions: [{ column: 'e', row: 2 }, { column: 'e', row: 8 }],
    wallsByPlayer: [],
  };
}

function probeOne(opp, mode, toAlgebraic) {
  return new Promise((resolve) => {
    const client = new QuoridorEngineClient(ENGINES[opp]);
    let lastInfoTime = null;
    let settled = false;
    let t0 = 0;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { client.destroy(); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => finish({
      ok: false, opp, mode, error: 'timeout 120s',
    }), 120_000);

    client.onInfo = (info) => {
      if (info.time != null) lastInfoTime = info.time;
    };
    client.onError = (e) => finish({ ok: false, opp, mode, error: String(e.message || e) });
    client.onBestMove = (action) => {
      clearTimeout(timer);
      const thinkMs = t0 ? Date.now() - t0 : null;
      finish({
        ok: true, opp, mode,
        move: toAlgebraic(action),
        visits: ENGINES[opp].visits[mode],
        thinkMs,
        serverTimeMs: lastInfoTime,
      });
    };

    client.onStatus = (s) => {
      if (s === 'idle' && !client._probed) {
        client._probed = true;
        client.setPosition(emptyBoardState());
        t0 = Date.now();
        client.go(mode);
      }
    };
    client.connect();
  });
}

async function main() {
  const gl = await import('./web/src/lib/gameLogic.js');
  const toAlgebraic = (action) => gl.toAlgebraic(action);
  const results = {};
  const availability = {};
  let failed = 0;

  console.log('Remote engine wiring test (Alpha strength, all time presets)\n');
  console.log('Health check:');
  for (const opp of OPPONENTS) {
    const h = await connectHealth(opp);
    availability[opp] = h.ok;
    console.log(`  ${opp.padEnd(8)} ${h.uri}  ${h.ok ? 'REACHABLE' : 'DOWN — ' + h.error}`);
    if (!h.ok) {
      results[opp] = {};
      failed += MODES.filter((m) => ENGINES[opp].visits[m]).length;
    }
  }
  console.log('');

  console.log('OPP      MODE         UI           VISITS      THINK   MOVE   STATUS');
  console.log('-'.repeat(72));

  for (const opp of OPPONENTS) {
    if (!availability[opp]) {
      console.log(`${opp.padEnd(8)} (skipped — server unreachable)`);
      continue;
    }
    results[opp] = {};
    for (const mode of MODES) {
      if (!ENGINES[opp].visits[mode]) {
        console.log(`${opp.padEnd(8)} ${mode.padEnd(12)} ${'-'.padStart(10)}  skipped (no preset)`);
        continue;
      }
      process.stderr.write(`  probing ${opp}@${mode}...\n`);
      const r = await probeOne(opp, mode, toAlgebraic);
      if (r.ok) {
        const sec = (r.thinkMs / 1000).toFixed(1);
        const thinkSec = Math.round(r.thinkMs / 100) / 10;
        results[opp][mode] = {
          think_sec: thinkSec,
          max_think_sec: thinkSec,
          think_ms: r.thinkMs,
          visits: r.visits,
          server_time_ms: r.serverTimeMs,
        };
        console.log(
          `${opp.padEnd(8)} ${mode.padEnd(12)} ${timeLabel(mode).padEnd(12)} ${String(r.visits).padStart(10)}  ${sec.padStart(6)}s  ${r.move.padEnd(6)} OK`,
        );
      } else {
        failed++;
        console.log(`${opp.padEnd(8)} ${mode.padEnd(12)}     FAIL   ${r.error}`);
      }
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    updated_at: new Date().toISOString(),
    note: 'Think times from live probe; bootstrap for fair-time before first remote move.',
    availability,
    timings: results,
  }, null, 2) + '\n');

  console.log(`\nSaved: ${OUT}`);
  if (!availability.ishtar) {
    console.log('\nIshtar: wss://quoridor-ai.com/ishtar-v3 is down (Ka works). Swiss skips Ishtar until probe passes.');
  }
  console.log(failed ? `\n${failed} probe(s) FAILED` : '\nAll probes OK');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
