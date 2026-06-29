/**
 * Node test entry for Titanium legality runtime.
 *
 * Threaded browser WASM needs async worker-pool setup and SharedArrayBuffer
 * isolation, so Node tests use the JS board oracle when build-meta says the
 * site artifact is a threaded browser build.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSync } from '../wasm/titanium/titanium.js';
import { parseAlgebraic, QuoridorBoard, toAlgebraic } from './gameLogic.js';
import {
  ORACLE_SOURCE,
  createSerializedLegalMovesRunner,
  enumerateTitaniumLegalMoves,
} from './titaniumLegalityCore.js';

const JS_BOARD_SOURCE = 'js-board-legality';
let initPromise = null;

function wasmModulePath() {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../wasm/titanium/titanium_bg.wasm',
  );
}

function buildMetaPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../wasm/titanium/build-meta.json');
}

function isThreadedBrowserWasm() {
  try {
    const meta = JSON.parse(readFileSync(buildMetaPath(), 'utf8'));
    return meta?.wasm_threads === true;
  } catch {
    return false;
  }
}

async function ensureWasmInit() {
  if (!initPromise) {
    initPromise = Promise.resolve().then(() => {
      const wasmPath = wasmModulePath();
      if (!existsSync(wasmPath)) {
        throw new Error(`Titanium WASM binary missing: ${wasmPath}`);
      }
      initSync({ module: readFileSync(wasmPath) });
    });
  }
  await initPromise;
}

function createJsBoardLegalityRuntime() {
  return {
    source: JS_BOARD_SOURCE,
    getLegalMoves({ historyTokens = [], signal }) {
      if (signal?.aborted) {
        throw new DOMException('Legality request aborted', 'AbortError');
      }
      const board = new QuoridorBoard();
      for (const token of historyTokens) {
        board.takeAction(parseAlgebraic(String(token)));
      }
      return board.validActions().map((action) => toAlgebraic(action));
    },
  };
}

export async function createTitaniumLegalityRuntime() {
  if (isThreadedBrowserWasm()) {
    return createJsBoardLegalityRuntime();
  }

  await ensureWasmInit();
  const runSerialized = createSerializedLegalMovesRunner();

  return {
    source: ORACLE_SOURCE,
    getLegalMoves({ historyTokens = [], signal }) {
      if (signal?.aborted) {
        throw new DOMException('Legality request aborted', 'AbortError');
      }

      return runSerialized(() => {
        if (signal?.aborted) {
          throw new DOMException('Legality request aborted', 'AbortError');
        }
        return enumerateTitaniumLegalMoves(historyTokens);
      });
    },
  };
}

export { wasmModulePath, isThreadedBrowserWasm };
