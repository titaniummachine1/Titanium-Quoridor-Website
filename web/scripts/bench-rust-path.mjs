/**
 * Measure where time goes: CLI genmove vs warm session vs HTTP proxy (same as website).
 * Usage: node scripts/bench-rust-path.mjs [timeSec] [engine]
 * Dev server must be running for HTTP tests (npm run dev).
 */

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const siteRoot = path.resolve(webDir, '..');
const monorepoRoot = path.resolve(siteRoot, '..');
const bin = path.join(monorepoRoot, 'engine', 'target', 'release', 'titanium.exe');
const timeSec = Number(process.argv[2] || 2);
const engine = process.argv[3] || 'ace-v10-ti-pmc';
const baseUrl = process.env.BENCH_URL || 'http://localhost:5173';

function lastInfoJson(stderr) {
  const line = stderr
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith('info json '));
  if (!line) return null;
  return JSON.parse(line.slice('info json '.length));
}

function benchGenmove(moves, label) {
  const args = ['genmove', ...moves, '--engine', engine, '--time', String(timeSec), '--log'];
  const t0 = performance.now();
  const r = spawnSync(bin, args, { encoding: 'utf8', cwd: monorepoRoot, maxBuffer: 8 * 1024 * 1024 });
  const wallMs = performance.now() - t0;
  const info = lastInfoJson(r.stderr || '');
  return {
    label,
    wallMs,
    engineMs: info?.elapsedMs ?? null,
    nodes: info?.nodes ?? null,
    depth: info?.searchDepth ?? null,
    overheadMs: info?.elapsedMs != null ? wallMs - info.elapsedMs : null,
    move: (r.stdout || '').trim().split(/\s+/).pop(),
  };
}

function benchSessionStdin(commands, label) {
  const input = commands.join('\n') + '\n';
  const args =
    engine.startsWith('ace') ? ['session', '--engine', engine] : ['session'];
  const t0 = performance.now();
  const r = spawnSync(bin, args, {
    input,
    encoding: 'utf8',
    cwd: monorepoRoot,
    maxBuffer: 8 * 1024 * 1024,
  });
  const wallMs = performance.now() - t0;
  const info = lastInfoJson(r.stderr || '');
  return {
    label,
    wallMs,
    engineMs: info?.elapsedMs ?? null,
    nodes: info?.nodes ?? null,
    depth: info?.searchDepth ?? null,
    overheadMs: info?.elapsedMs != null ? wallMs - info.elapsedMs : null,
    stdout: (r.stdout || '').trim().split(/\n/).slice(-3),
  };
}

async function postSession(seatId, body, stream = false) {
  const t0 = performance.now();
  const res = await fetch(`${baseUrl}/api/titanium/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify({ seatId, engine, ...body }),
  });
  if (!stream) {
    const data = await res.json().catch(() => ({}));
    return { wallMs: performance.now() - t0, ok: res.ok, data };
  }

  let lastInfo = null;
  let bestmove = null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const data = JSON.parse(line.slice(6));
      if (data.type === 'info') lastInfo = data;
      if (data.type === 'bestmove') bestmove = data;
    }
  }
  const wallMs = performance.now() - t0;
  return {
    wallMs,
    ok: res.ok,
    engineMs: lastInfo?.elapsedMs ?? null,
    nodes: lastInfo?.nodes ?? null,
    depth: lastInfo?.searchDepth ?? null,
    overheadMs: lastInfo?.elapsedMs != null ? wallMs - lastInfo.elapsedMs : null,
    bestmove,
    lastInfo,
  };
}

function fmt(row) {
  const oh =
    row.overheadMs != null ? `${row.overheadMs.toFixed(1)}ms overhead` : 'n/a overhead';
  return [
    row.label.padEnd(42),
    `wall=${row.wallMs.toFixed(1)}ms`,
    `engine=${row.engineMs ?? '?'}ms`,
    oh,
    `d${row.depth ?? '?'} nodes=${row.nodes ?? '?'}`,
  ].join(' | ');
}

console.log(`\nBench: engine=${engine} time=${timeSec}s bin=${bin}\n`);

const rows = [];

rows.push(benchGenmove([], 'CLI genmove startpos (cold TT)'));
rows.push(benchGenmove(['e2'], 'CLI genmove after e2 (cold TT)'));

rows.push(
  benchSessionStdin(
    ['reset', `go ${timeSec} 2000000000`, 'quit'],
    'CLI session startpos ply1 (warm spawn+go)',
  ),
);

rows.push(
  benchSessionStdin(
    ['reset', `go ${timeSec} 2000000000`, 'makemove e2', `go ${timeSec} 2000000000`, 'quit'],
    'CLI session after e2 ply2 (same process)',
  ),
);

// Website path: forceFull position replay before every go (titaniumRustClient.js)
try {
  const seat = `bench-${Date.now()}`;
  const spawnT0 = performance.now();
  await postSession(seat, { op: 'reset' });
  rows.push({
    label: 'HTTP seat spawn (reset only)',
    wallMs: performance.now() - spawnT0,
    engineMs: null,
    nodes: null,
    depth: null,
    overheadMs: null,
  });

  // mimic website: forceFull position replay, then go stream (titaniumRustClient.js)
  await postSession(seat, { op: 'position', moves: [] });
  let go = await postSession(seat, {
    op: 'go',
    timeSec,
    maxNodes: 2_000_000_000,
    stream: true,
  });
  go.label = 'HTTP startpos ply1 (position+go, warm seat)';
  rows.push(go);

  await postSession(seat, { op: 'position', moves: ['e2'] });
  go = await postSession(seat, {
    op: 'go',
    timeSec,
    maxNodes: 2_000_000_000,
    stream: true,
  });
  go.label = 'HTTP session after e2 (website position+go)';
  rows.push(go);

  await postSession(seat, { op: 'destroy' });
} catch (e) {
  console.warn('HTTP bench skipped (is npm run dev up?):', e.message);
}

console.log('--- results ---');
for (const row of rows) {
  if (row && row.label) console.log(fmt(row));
}

console.log(`
Interpret:
  engineMs = Rust think() elapsed (from info json) — the actual search.
  overhead = wall - engineMs — spawn, IPC, HTTP, SSE, JSON, position replay.
  If engineMs matches CLI but wall differs → website overhead only.
  If engineMs much higher on HTTP/session → investigate session path.
`);
