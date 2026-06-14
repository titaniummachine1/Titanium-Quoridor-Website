/**
 * ACE Rust (MoveGen+ / native port) in a Web Worker — compiled to WebAssembly.
 * GitHub Pages has no Vite proxy; this replaces the dev-only titanium.exe session.
 */

import init, { WasmAceEngine } from '../wasm/titanium/titanium.js';

let engine = null;
let initPromise = null;

async function ensureEngine() {
  if (!initPromise) {
    initPromise = init().then(() => {
      engine = new WasmAceEngine();
    });
  }
  await initPromise;
  return engine;
}

self.onmessage = async (event) => {
  const { algebraicMoves, timeMs, maxDepth, engineMode } = event.data ?? {};
  try {
    const wasm = await ensureEngine();
    const history = algebraicMoves ?? [];
    const best = wasm.genmove(
      history.join(' '),
      Math.max(1, timeMs ?? 2000),
      maxDepth ?? 30,
      engineMode ?? 'ace-v13-ti',
    );
    if (!best || best === '(none)') {
      self.postMessage({ type: 'error', message: 'ACE WASM returned no legal move' });
      return;
    }
    self.postMessage({
      type: 'bestmove',
      algebraicMove: best,
      stoppedBy: engineMode ?? 'ace-wasm',
      mode: engineMode ?? 'ace-wasm',
      nodes: 0,
    });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err?.message ?? String(err),
    });
  }
};
