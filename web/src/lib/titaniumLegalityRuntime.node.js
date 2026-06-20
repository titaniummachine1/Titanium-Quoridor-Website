/**
 * Node test entry for Titanium WASM legality runtime (initSync + readFileSync).
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSync } from '../wasm/titanium/titanium.js';
import {
  ORACLE_SOURCE,
  createSerializedLegalMovesRunner,
  enumerateTitaniumLegalMoves,
} from './titaniumLegalityCore.js';

let initPromise = null;

function wasmModulePath() {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../wasm/titanium/titanium_bg.wasm',
  );
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

export async function createTitaniumLegalityRuntime() {
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

export { wasmModulePath };
