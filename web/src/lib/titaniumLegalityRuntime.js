/**
 * Browser Titanium WASM legality runtime (bundled assets via Vite).
 */

import init from '../wasm/titanium/titanium.js';
import {
  ORACLE_SOURCE,
  createSerializedLegalMovesRunner,
  enumerateTitaniumLegalMoves,
} from './titaniumLegalityCore.js';

let initPromise = null;

async function ensureWasmInit() {
  if (!initPromise) {
    initPromise = init();
  }
  await initPromise;
}

/**
 * @returns {Promise<{ getLegalMoves: Function, source: string }>}
 */
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
