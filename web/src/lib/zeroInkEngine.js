/**
 * quoridor-zero.ink — remote AlphaZero bot exposed over a stateless REST API.
 *
 * Every move is a self-contained POST to `/api/play` with the full position and
 * a visit budget from the Time preset (Intuition / Short / Medium / Long).
 *
 * Wire format (POST /api/play, Content-Type: application/json):
 *   Request:  { state: <zero.ink state>, visits }
 *   Response: { move, score, thinkMs, stateAfter }
 *
 * Live UI: emit `onInfo` with `thinking: true` while the request is in flight,
 * then again with the final PV/score before `onBestMove`.
 */

import { QuoridorBoard, toAlgebraic } from './gameLogic.js';
import { boardToZeroInkState, zeroInkMoveToAction, zeroInkMoveToAlgebraic } from './zeroInkCodec.js';
import { createAbortError } from './engineAbort.js';
import { TimeToMove } from './engineConfig.js';

const ZEROINK_HOST = 'https://quoridor-zero.ink';

export class ZeroInkEngineClient {
  constructor(engineConfig) {
    this.config = engineConfig;
    this.pendingController = null;
    this.queuedRequest = null;
    this.busy = false;
  }

  ponder() {}
  stopPonder() {
    this.setStatus('idle');
  }

  cancelSearch() {
    this.queuedRequest = null;
    if (this.pendingController) {
      this.pendingController.abort();
      this.pendingController = null;
    }
    this.busy = false;
    this.setStatus('idle');
  }

  clearQueuedSearches() {
    this.queuedRequest = null;
  }

  destroy() {
    this.cancelSearch();
  }

  resetConnection() {
    this.destroy();
  }

  makeMoves() {
    this.setStatus('idle');
  }

  requestMove(params) {
    if (this.busy) {
      this.queuedRequest = params;
      return;
    }
    this.startRequest(params);
  }

  drainQueuedRequest() {
    if (!this.queuedRequest) {
      return;
    }
    const next = this.queuedRequest;
    this.queuedRequest = null;
    this.startRequest(next);
  }

  buildBoard(moveHistory) {
    const board = new QuoridorBoard();
    for (const action of moveHistory ?? []) {
      board.takeAction(action);
    }
    return board;
  }

  postJson(path, body, signal) {
    return fetch(`${ZEROINK_HOST}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }).then(async (response) => {
      if (!response.ok) {
        let detail = `${response.status} ${response.statusText}`;
        try {
          const errBody = await response.json();
          if (errBody?.error) detail = errBody.error;
        } catch {
          /* ignore */
        }
        throw new Error(`zero.ink: ${detail}`);
      }
      return response.json();
    });
  }

  async startRequest(params) {
    const { aiSettings, moveHistory, signal } = params;
    this.busy = true;
    this.setStatus('searching');
    const started = performance.now();

    const board = this.buildBoard(moveHistory);
    const state = boardToZeroInkState(board);
    const timeMode = aiSettings?.timeToMove ?? TimeToMove.Short;
    const visits = this.config?.visits?.[timeMode] ?? this.config?.visits?.[TimeToMove.Short];

    const abort = new AbortController();
    this.pendingController = abort;
    const onExternalAbort = () => abort.abort();
    if (signal) {
      if (signal.aborted) {
        abort.abort();
      } else {
        signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    this.onInfo?.({
      thinking: true,
      mode: 'zeroink',
      visits,
    });

    try {
      const result = await this.postJson('/api/play', { state, visits }, abort.signal);

      const move = result?.move;
      if (!move) {
        throw new Error('zero.ink returned no move');
      }
      const action = zeroInkMoveToAction(move);
      const pv = zeroInkMoveToAlgebraic(move);

      if (!board.isValid(action)) {
        throw new Error(
          `zero.ink returned an illegal move (${toAlgebraic(action)}) for this position`,
        );
      }

      const elapsed = performance.now() - started;
      const rootWinRate = typeof result.score === 'number' ? result.score : undefined;

      this.onInfo?.({
        thinking: true,
        mode: 'zeroink',
        visits,
        time: elapsed,
        elapsedMs: Math.round(elapsed),
        rootWinRate,
        pv,
        nodes: visits,
        progress: 0.99,
      });

      this.finish();
      this.onInfo?.({
        time: elapsed,
        elapsedMs: Math.round(elapsed),
        rootWinRate,
        visits,
        pv,
        nodes: visits,
        stoppedBy: 'zeroink',
        mode: 'zeroink',
        progress: 1,
      });

      const outcome = this.onBestMove?.(action);
      if (outcome === 'stale' || outcome === false) {
        this.clearQueuedSearches();
      } else {
        this.drainQueuedRequest();
      }
    } catch (error) {
      const aborted =
        error?.name === 'AbortError' || signal?.aborted || abort.signal.aborted;
      this.finish();
      if (aborted) {
        this.onError?.(createAbortError());
        return;
      }
      this.setStatus('error');
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
      this.drainQueuedRequest();
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  finish() {
    this.pendingController = null;
    this.busy = false;
  }

  setStatus(status) {
    this.onStatus?.(status);
  }
}
