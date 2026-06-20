/**
 * Compact player card — shown above and below the board.
 *
 * Shows: pawn icon, player name, turn status, thinking progress,
 * engine-specific live settings, and a "Play now" button when safe.
 */

import { PlayerType } from '../lib/engineConfig.js';
import { playerColorName } from '../lib/playerColors.js';
import { formatScoreForCard, isMateScore } from '../lib/engineScore.js';
import { canPlayNow, resolveLiveBestMoveKey } from '../lib/liveBestMove.js';
import { aceStrengthPresetsForPlayerType } from '../lib/aceTier.js';
import {
  STRENGTH_LEVEL_PRESETS,
  TIME_TO_MOVE_PRESETS,
  formatMaxDepth,
  formatVisitsCap,
  formatWallClock,
  maxDepthFromVisitsBudget,
  visitsFromSliderPosition,
} from '../lib/timeControl.js';
import { renderDiscreteSlider } from './discreteSlider.js';
import { wireRangeSlider } from './sliderWire.js';

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMs(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '';
  const n = Number(ms);
  return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`;
}

function formatNodes(n) {
  if (!n || n <= 0) return '';
  return Number(n).toLocaleString();
}

function resolvePayloadScore(snap) {
  if (!snap) return null;
  const deep = deepestEntry(snap.depthLog);
  return deep?.score ?? snap.score ?? snap.rootScore ?? null;
}

function deepestEntry(depthLog) {
  if (!depthLog?.length) return null;
  return depthLog.reduce((best, e) => (e.depth > (best?.depth ?? 0) ? e : best));
}

function resolveNodes(snap) {
  if (!snap) return 0;
  const deep = deepestEntry(snap.depthLog);
  return Math.max(
    Number(snap.nodes) || 0,
    Number(snap.simulations) || 0,
    Number(deep?.nodes) || 0,
  );
}

function resolveDepth(snap) {
  if (!snap) return null;
  const deep = deepestEntry(snap.depthLog);
  return deep?.depth ?? snap.depth ?? snap.searchDepth ?? null;
}

function renderLiveSettings(ui, playerNum) {
  if (!ui || ui.isHuman) return '';

  if (ui.isLocalMcts) {
    const { min: tMin, max: tMax, step: tStep } = ui.wallclockRange;
    const { min: vMin, max: vMax, step: vStep } = ui.visitsRange;
    const budgetLabel = ui.isTitanium ? 'Nodes' : ui.isQuoridorV3 ? 'Depth' : 'Rollouts';
    const visitsSlider = ui.isAceEngine
      ? ''
      : `
        <label class="control-label control-label--sub">${budgetLabel}</label>
        <div class="time-slider-row">
          <input type="range" class="time-slider scraped-slider"
            data-setting="visits-${playerNum}" min="${vMin}" max="${vMax}" step="${vStep}"
            value="${ui.visitsSliderPosition}" />
          <output class="time-slider-value" data-visits-label="${playerNum}">${
            ui.isQuoridorV3
              ? formatMaxDepth(maxDepthFromVisitsBudget(ui.visitsBudget))
              : formatVisitsCap(ui.visitsBudget)
          }</output>
        </div>`;

    return `
      <details class="player-card__settings"${ui.isThinking ? ' open' : ''}>
        <summary class="player-card__settings-toggle">Engine settings</summary>
        <div class="player-ai-settings player-ai-settings--compact">
          ${ui.isTitanium
            ? renderDiscreteSlider({
              label: 'Strength',
              settingName: 'strength-level',
              playerNum,
              value: ui.strengthLevel,
              presets: STRENGTH_LEVEL_PRESETS,
            })
            : ''}
          ${ui.isAceFamily
            ? renderDiscreteSlider({
              label: 'Version',
              settingName: 'strength-level',
              playerNum,
              value: ui.strengthLevel,
              presets: aceStrengthPresetsForPlayerType(ui.playerType),
            })
            : ''}
          <label class="control-label control-label--sub">Time</label>
          <div class="time-slider-row">
            <input type="range" class="time-slider scraped-slider"
              data-setting="wallclock-${playerNum}" min="${tMin}" max="${tMax}" step="${tStep}"
              value="${ui.wallClockSeconds}" />
            <output class="time-slider-value" data-wallclock-label="${playerNum}">${formatWallClock(ui.wallClockSeconds)}</output>
          </div>
          ${visitsSlider}
        </div>
      </details>`;
  }

  if (ui.isRemote) {
    return `
      <details class="player-card__settings"${ui.isThinking ? ' open' : ''}>
        <summary class="player-card__settings-toggle">Engine settings</summary>
        <div class="player-ai-settings player-ai-settings--compact">
          ${renderDiscreteSlider({
            label: 'Strength',
            settingName: 'strength-level',
            playerNum,
            value: ui.strengthLevel,
            presets: STRENGTH_LEVEL_PRESETS,
          })}
          ${renderDiscreteSlider({
            label: 'Thinking mode',
            settingName: 'time-to-move',
            playerNum,
            value: ui.timeToMove,
            presets: TIME_TO_MOVE_PRESETS,
          })}
        </div>
      </details>`;
  }

  return '';
}

function wireLiveSettings(container, controller, playerNum) {
  const refresh = () => controller.onChange?.();

  wireRangeSlider(
    container,
    `[data-setting="strength-level-${playerNum}"]`,
    (value) => controller.setPlayerStrengthLevel(playerNum, value, { silent: true }),
    () => controller._afterLivePlayerSettingChange(playerNum, { rebindEngine: true }),
  );

  wireRangeSlider(
    container,
    `[data-setting="time-to-move-${playerNum}"]`,
    (value) => controller.setPlayerTimeToMove(playerNum, value, { silent: true }),
    () => controller._afterLivePlayerSettingChange(playerNum, { rebindEngine: true }),
  );

  wireRangeSlider(
    container,
    `[data-setting="wallclock-${playerNum}"]`,
    (value) => {
      controller.setPlayerWallClock(playerNum, value, { silent: true });
      const label = container.querySelector(`[data-wallclock-label="${playerNum}"]`);
      if (label) label.textContent = formatWallClock(Number(value));
    },
    () => controller._afterLivePlayerSettingChange(playerNum),
  );

  wireRangeSlider(
    container,
    `[data-setting="visits-${playerNum}"]`,
    (value) => {
      const visits = visitsFromSliderPosition(value);
      controller.setPlayerVisitsBudget(playerNum, visits, { silent: true });
      const label = container.querySelector(`[data-visits-label="${playerNum}"]`);
      if (label) {
        const isV3 = controller.getPlayerAiSettingsUiForSlot(playerNum).isQuoridorV3;
        label.textContent = isV3
          ? formatMaxDepth(maxDepthFromVisitsBudget(visits))
          : formatVisitsCap(visits);
      }
    },
    () => controller._afterLivePlayerSettingChange(playerNum),
  );
}

export function renderPlayerCard(container, state, seatIndex, controller) {
  const playerType = state.settings.players[seatIndex];
  const isHuman = playerType === PlayerType.Human;
  const isThinking = state.aiThinking && state.thinkingSeatIndex === seatIndex;
  const isMyTurn = !state.winner && !state.isDraw && state.playerToMove === seatIndex + 1;
  const colorName = playerColorName(seatIndex + 1);
  const ui = state.playerAiSettingsUi?.[seatIndex];

  const liveSnap = isThinking ? state.liveSearch : null;
  const completedSnap = state.lastCompletedThinkBySeat?.[seatIndex];
  const snap = liveSnap ?? completedSnap;

  const engineName = resolveEngineName(playerType, state, seatIndex);
  const bestMove = snap?.move ?? (liveSnap ? null : completedSnap?.move ?? null);
  const depth = resolveDepth(snap);
  const nodes = resolveNodes(snap);
  const score = resolvePayloadScore(snap);
  const thinkMs = liveSnap?.elapsedMs ?? snap?.thinkMs ?? null;
  const rootWinRate = snap?.rootWinRate ?? null;

  const livePvMove = isThinking
    ? resolveLiveBestMoveKey({
      ...state,
      thinkingSeatIndex: seatIndex,
      searchGeneration: state.searchGeneration,
    })
    : null;

  let statusText = '';
  if (state.winner) {
    statusText = state.winner === seatIndex + 1 ? 'Winner!' : '';
  } else if (state.isDraw) {
    statusText = 'Draw';
  } else if (isThinking) {
    statusText = 'Thinking…';
  } else if (isMyTurn && isHuman) {
    statusText = 'Your turn';
  } else if (isMyTurn) {
    statusText = 'Waiting…';
  }

  let scoreDisplay = '';
  const isMate = isMateScore(score);
  if (score != null && Number.isFinite(Number(score))) {
    scoreDisplay = formatScoreForCard(score);
  } else if (rootWinRate != null) {
    scoreDisplay = `${(rootWinRate * 100).toFixed(0)}%`;
  }

  const showPlayNow = isThinking && canPlayNow({
    ...state,
    thinkingSeatIndex: seatIndex,
    searchGeneration: state.searchGeneration,
  });

  container.innerHTML = `
    <div class="player-card player-card--seat${seatIndex}${isMyTurn ? ' player-card--active' : ''}${state.winner === seatIndex + 1 ? ' player-card--winner' : ''}">
      <div class="player-card__left">
        <div class="player-card__pawn pawn-icon pawn-icon--seat${seatIndex}"></div>
        <div class="player-card__info">
          <div class="player-card__name">${escHtml(colorName)}
            <span class="player-card__engine-label">${escHtml(isHuman ? 'Human' : engineName)}</span>
          </div>
          ${statusText ? `<div class="player-card__status${isThinking ? ' player-card__status--thinking' : ''}">${escHtml(statusText)}</div>` : ''}
          ${bestMove && !isThinking ? `<div class="player-card__bestmove">played <strong>${escHtml(bestMove)}</strong></div>` : ''}
          ${livePvMove ? `<div class="player-card__bestmove">pv <strong>${escHtml(livePvMove)}</strong></div>` : ''}
        </div>
      </div>
      <div class="player-card__right">
        <div class="player-card__stats">
          ${scoreDisplay ? `<span class="player-card__score${isMate ? ' player-card__score--mate' : ''}">${escHtml(scoreDisplay)}</span>` : ''}
          ${depth != null ? `<span class="player-card__stat"><span class="player-card__stat-label">d</span>${depth}</span>` : ''}
          ${nodes > 0 ? `<span class="player-card__stat"><span class="player-card__stat-label">n</span>${escHtml(formatNodes(nodes))}</span>` : ''}
          ${thinkMs != null ? `<span class="player-card__stat">${escHtml(formatMs(thinkMs))}</span>` : ''}
        </div>
        ${showPlayNow ? `<button class="btn btn--playnow" data-action="play-now" title="Stop search and play current best move">Play now</button>` : ''}
      </div>
      ${renderLiveSettings(ui ? { ...ui, isThinking } : null, seatIndex + 1)}
    </div>
  `;

  if (!isHuman && ui) {
    wireLiveSettings(container, controller, seatIndex + 1);
  }

  container.querySelector('[data-action="play-now"]')?.addEventListener('click', () => {
    controller.playNow?.();
  });
}

function resolveEngineName(playerType, state, seatIndex) {
  if (playerType === PlayerType.Human) return 'Human';
  if (playerType === PlayerType.TitaniumMinimax) return 'Titanium v15';
  if (playerType === PlayerType.TitaniumV15Frozen) return 'Titanium v15 (frozen)';
  if (playerType === PlayerType.GorisansonMCTS) return 'Gorisanson';
  if (playerType === PlayerType.QuoridorV3) return 'Quoridor v3';
  if (playerType === PlayerType.KaAI) return 'Ka';
  if (playerType === PlayerType.IshtarV3 || playerType === PlayerType.IshtarPonder) return 'Ishtar';
  if (playerType === PlayerType.AceV10) return 'ACE v10';
  if (playerType === PlayerType.AceV13) return 'ACE v13';
  if (playerType === PlayerType.AceV8) return 'ACE v8';
  return String(playerType);
}
