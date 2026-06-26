/**
 * Titanium v15 in a Web Worker — Rust engine compiled to WebAssembly.
 * Difficulty tiers: Easy (frozen), Medium (previous live), Hard (latest live).
 * Multi-worker LazySMP: each worker runs an independent WasmEngine with a SearchProfile lane.
 */

import init, { WasmEngine } from '../wasm/titanium/titanium.js';

let initPromise = null;
/** @type {Map<string, import('../wasm/titanium/titanium.js').WasmEngine>} */
const engines = new Map();

function tierForEngineMode(engineMode) {
  if (engineMode === 'titanium-v15-frozen') return 0;
  if (engineMode === 'titanium-v15-medium') return 1;
  return 2;
}

async function ensureInit() {
  if (!initPromise) {
    initPromise = init();
  }
  await initPromise;
}

async function ensureEngine(engineMode = 'titanium-v15') {
  await ensureInit();
  if (!engines.has(engineMode)) {
    engines.set(engineMode, new WasmEngine(tierForEngineMode(engineMode)));
  }
  return engines.get(engineMode);
}

function parseProgressJson(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/** Mirror `SearchProfile::helper` in engine/src/titanium/search.rs */
function helperProfile(workerId) {
  const lane = Math.min(workerId, 4);
  return {
    lateWallSkipPct: Math.min(lane * 20, 60),
    lmrBias: Math.min(Math.max(lane - 1, 0), 3),
  };
}

self.onmessage = async (event) => {
  const {
    algebraicMoves,
    timeMs,
    maxNodes,
    isFreshGame,
    engineMode = 'titanium-v15',
    workerId = 0,
    lateWallSkipPct,
    lmrBias,
  } = event.data ?? {};
  try {
    const wasm = await ensureEngine(engineMode);
    if (isFreshGame) {
      wasm.reset();
    }
    const history = algebraicMoves ?? [];
    if (history.length > 0) {
      wasm.position(history.join(' '));
    } else if (isFreshGame) {
      wasm.reset();
    }

    const isMain = workerId === 0;
    const onProgress = isMain
      ? (jsonStr) => {
          const data = parseProgressJson(jsonStr);
          if (!data) {
            return;
          }
          self.postMessage({
            type: 'info',
            thinking: true,
            workerId,
            ...data,
            mode: data.engine ?? data.stoppedBy ?? engineMode,
          });
        }
      : undefined;

    const profileSkip =
      lateWallSkipPct != null ? lateWallSkipPct : helperProfile(workerId).lateWallSkipPct;
    const profileBias = lmrBias != null ? lmrBias : helperProfile(workerId).lmrBias;

    const best =
      typeof wasm.go_with_profile === 'function'
        ? wasm.go_with_profile(
            Math.max(1, timeMs ?? 10_000),
            maxNodes ?? 0,
            workerId,
            profileSkip,
            profileBias,
            onProgress,
          )
        : wasm.go(Math.max(1, timeMs ?? 10_000), maxNodes ?? 0, onProgress);

    if (!best || best === '(none)') {
      self.postMessage({
        type: 'error',
        workerId,
        message: 'WASM engine returned no legal move',
      });
      return;
    }

    const depth =
      typeof wasm.last_search_depth === 'function' ? wasm.last_search_depth() : undefined;
    const nodes =
      typeof wasm.last_search_nodes === 'function' ? Number(wasm.last_search_nodes()) : undefined;

    self.postMessage({
      type: 'bestmove',
      algebraicMove: best,
      workerId,
      depth,
      nodes,
      stoppedBy: engineMode,
      mode: engineMode,
    });
  } catch (err) {
    self.postMessage({
      type: 'error',
      workerId: event.data?.workerId ?? 0,
      message: err?.message ?? String(err),
    });
  }
};
