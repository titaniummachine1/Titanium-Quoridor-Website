/**
 * Titanium negamax in a Web Worker — Rust engine compiled to WebAssembly.
 */

import init, { WasmEngine } from '../wasm/titanium/titanium.js';

let engine = null;
let initPromise = null;

async function ensureEngine() {
  if (!initPromise) {
    initPromise = init().then(() => {
      engine = new WasmEngine();
    });
  }
  await initPromise;
  return engine;
}

self.onmessage = async (event) => {
  const { algebraicMoves, timeMs, maxNodes, isFreshGame } = event.data ?? {};
  try {
    const wasm = await ensureEngine();
    if (isFreshGame) {
      wasm.reset();
    }
    const history = algebraicMoves ?? [];
    if (history.length > 0) {
      wasm.position(history.join(' '));
    } else if (isFreshGame) {
      wasm.reset();
    }
    const best = wasm.go(Math.max(1, timeMs ?? 10_000), maxNodes ?? 0);
    if (!best || best === '(none)') {
      self.postMessage({ type: 'error', message: 'WASM engine returned no legal move' });
      return;
    }
    self.postMessage({
      type: 'bestmove',
      algebraicMove: best,
      stoppedBy: 'minimax',
      mode: 'minimax',
      nodes: 0,
    });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err?.message ?? String(err),
    });
  }
};
