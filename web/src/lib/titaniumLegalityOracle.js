import {
  TitaniumOracleStatus,
  availableTitaniumMoves,
  invalidTitaniumPosition,
  unavailableTitaniumOracle,
} from './titaniumOracleResult.js';
import { INVALID_TITANIUM_POSITION_CODE } from './titaniumLegalityCore.js';

export class TitaniumLegalityOracle {
  constructor({ createRuntime }) {
    this.createRuntime = createRuntime;
    this.runtime = null;
    this.readyPromise = null;
    this.initializationError = null;
  }

  ensureReady() {
    if (this.runtime) {
      return Promise.resolve(this.runtime);
    }

    if (this.initializationError) {
      return Promise.reject(this.initializationError);
    }

    if (!this.readyPromise) {
      this.readyPromise = this.createRuntime()
        .then((runtime) => {
          if (!runtime) {
            throw new Error('Titanium legality runtime factory returned null');
          }
          this.runtime = runtime;
          return runtime;
        })
        .catch((error) => {
          this.initializationError = error;
          throw error;
        });
    }

    return this.readyPromise;
  }

  async legalMoves({ historyTokens, positionKey, signal }) {
    const source = 'titanium-wasm-legality';

    try {
      const runtime = await this.ensureReady();

      if (signal?.aborted) {
        throw new DOMException('Legality request aborted', 'AbortError');
      }

      const rawMoves = await runtime.getLegalMoves({ historyTokens, signal });

      if (!Array.isArray(rawMoves)) {
        throw new TypeError(
          'Titanium legality runtime returned a non-array legal move result',
        );
      }

      return availableTitaniumMoves({
        moves: rawMoves,
        positionKey,
        source,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        return unavailableTitaniumOracle({ positionKey, source, error });
      }

      if (error?.code === INVALID_TITANIUM_POSITION_CODE) {
        return invalidTitaniumPosition({ positionKey, source, error });
      }

      return unavailableTitaniumOracle({ positionKey, source, error });
    }
  }
}

export { TitaniumOracleStatus };
