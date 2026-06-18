#!/usr/bin/env node
/**
 * Isolated Ka/Ishtar game worker — own process so WebSocket I/O cannot block local games.
 * Ka is stateless search: parent harness (ishtar_match.js) makemoves every ply + replays on reconnect.
 * Progress events sent to parent via IPC.
 */
'use strict';

const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { preload: preloadRemoteTiming } = require('./remote_timing');
const remoteMatch = require('./ishtar_match');
const { isCompleteGame } = require('./game_validate');
const { releaseRemoteSlot, upsertGame } = require('./coordinator_client');

const BIN = path.resolve(__dirname, '../engine/target/release/titanium.exe');

function timingModeForVisits(visits) {
  if (visits <= 1) return 'intuition';
  if (visits <= 1000) return 'short';
  if (visits <= 20_000) return 'medium';
  return 'long';
}

function runZeroGame(p, slot, progress) {
  return new Promise((resolve, reject) => {
    const script = path.resolve(__dirname, '../training/zero_teacher/play_adaptive.py');
    const child = spawn('python', [
      script,
      '--visits', String(p.opponent_visits ?? 1),
      '--our-is-p1', p.our_is_p1 === false ? '0' : '1',
      '--engine', p.engine_a,
      '--bin', BIN,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const rl = readline.createInterface({ input: child.stdout });
    let result = null;
    let errTail = '';
    child.stderr.on('data', (data) => { errTail = (errTail + data).slice(-2000); });
    rl.on('line', (line) => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'ply') progress.ply(slot, event.ply, 300);
      else if (event.type === 'result') result = event;
      else if (event.type === 'error') errTail = event.error || errTail;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      rl.close();
      if (code !== 0 || !result) {
        reject(new Error(errTail || `zero-ink worker exited ${code}`));
      } else {
        resolve(result);
      }
    });
  });
}

function ipcProgress(slot) {
  const send = (msg) => {
    if (typeof process.send === 'function') process.send(msg);
  };
  return {
    setSlotLabel() {},
    start(s, gameIdx, maxPly, matchLabel = '') {
      send({ type: 'start', slot: s, maxPly, matchLabel });
    },
    ply(s, ply, maxPly) {
      send({ type: 'ply', slot: s, ply, maxPly });
    },
    thinking(s, side, budgetSec) {
      send({ type: 'think', slot: s, side, budgetSec });
    },
    reconnect(s, attempt) {
      send({ type: 'reconnect', slot: s, attempt });
    },
    finish(s, data) {
      send({ type: 'finish', slot: s, ...data });
    },
    idle(s) {
      send({ type: 'idle', slot: s });
    },
    note(msg) {
      send({ type: 'note', slot, msg: String(msg) });
    },
  };
}

let workerGameId = null;

async function main() {
  preloadRemoteTiming();
  const payload = JSON.parse(process.argv[2]);
  const { pairing: p, slot } = payload;
  workerGameId = p.game_id;
  const label = p.display_label || process.env.MATCH_LABEL || `v15@5s vs Ka-${p.tc_b}`;

  if (p.engine_b === 'zero') {
    const progress = ipcProgress(slot);
    progress.start(slot, 0, 300, label);
    const r = await runZeroGame(p, slot, progress);
    if (!r.complete || !isCompleteGame(r)) {
      progress.finish(slot, { plies: r.plies, label: 'incomplete retry' });
      await releaseRemoteSlot(workerGameId).catch(() => {});
      process.send?.({ type: 'done', slot, label, plies: r.plies, skipped: true });
      return;
    }
    const gameResp = await upsertGame({
      moves: r.moves,
      result: r.result,
      tag: p.source_tag,
      releaseRemote: true,
      gameId: workerGameId,
      curriculumOpponent: 'zero',
      ourWin: r.our_win,
      opponentVisits: p.opponent_visits,
    });
    const prior = await remoteMatch.loadPriorMatchup(
      p.engine_a, p.engine_b, '5s', p.tc_b,
    );
    const ourW = prior.ourW + (gameResp.inserted && r.our_win ? 1 : 0);
    const oppW = prior.oppW + (gameResp.inserted && !r.our_win ? 1 : 0);
    if (gameResp.inserted) {
      await remoteMatch.updateMatchup({
        engine: p.engine_a,
        opp: p.engine_b,
        oppTime: p.tc_b,
        sourceTag: p.source_tag,
        saveGames: null,
      }, ourW, oppW, () => {});
    }
    progress.finish(slot, { plies: r.plies, label: r.our_win ? 'we win' : 'zero wins' });
    process.send?.({
      type: 'done', slot, label, plies: r.plies,
      ourW,
      oppW,
      dbId: gameResp?.game_id ?? null,
    });
    process.exit(0);
  }

  const opts = {
    engine: p.engine_a,
    opp: p.engine_b,
    oppTime: p.tc_b,
    timingMode: timingModeForVisits(p.opponent_visits ?? 1),
    oppVisits: p.opponent_visits ?? null,
    fairTime: true,
    ponderTime: 0,
    ourTime: 10,
    maxPly: 300,
    bin: BIN,
    saveGames: null,
    sourceTag: p.source_tag,
    gameId: p.game_id,
  };

  const gl = await import('./web/src/lib/gameLogic.js');
  const progress = ipcProgress(slot);

  const prior = await remoteMatch.loadPriorMatchup(
    opts.engine, opts.opp, remoteMatch.ourTcLabel(opts), opts.oppTime,
  );
  let ourW = prior.ourW;
  let oppW = prior.oppW;

  const r = await remoteMatch.playGame(opts, gl, 0, p.our_is_p1 !== false, slot, progress);

  if (!isCompleteGame(r)) {
    progress.finish(slot, { plies: r.plies, label: 'incomplete skip' });
    await releaseRemoteSlot(workerGameId).catch(() => {});
    process.send?.({ type: 'done', slot, label, plies: r.plies, ourW, oppW, skipped: true });
    return;
  }

  const result = r.winner === 1 ? 'W' : 'B';
  const gameResp = await upsertGame({
    moves: r.moves,
    result,
    tag: opts.sourceTag,
    releaseRemote: true,
    gameId: workerGameId,
    curriculumOpponent: p.opponent_profile === 'adaptive' ? p.engine_b : null,
    ourWin: r.ourWin,
    opponentVisits: p.opponent_visits,
  });
  if (gameResp.inserted) {
    if (r.ourWin) ourW += 1;
    else oppW += 1;
    await remoteMatch.updateMatchup(opts, ourW, oppW, () => {});
  }

  process.send?.({
    type: 'done',
    slot,
    label,
    plies: r.plies,
    ourW,
    oppW,
    dbId: gameResp?.game_id ?? null,
  });
  process.exit(0);
}

main().catch(async (e) => {
  await releaseRemoteSlot(workerGameId).catch(() => {});
  const shortMsg = e.message || String(e);
  const fullMsg = e.stack || shortMsg;
  process.send?.({ type: 'error', error: shortMsg });  // one-liner for parent's progress bar
  process.stderr.write(`remote_game_worker FATAL: ${fullMsg}\n`);
  process.exit(1);
});
