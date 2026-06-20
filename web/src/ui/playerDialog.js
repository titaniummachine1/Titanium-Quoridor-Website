/**
 * Player selection dialog — shown on page load, "New Game", and "Change players".
 *
 * For each seat:
 *   - Player type select (all engines from playerRegistry)
 *   - Strength preset (Instant / Fast / Normal / Strong / Maximum)
 *   - Thinking time slider (0.5 s – 60 s)
 *
 * Settings are persisted to localStorage and restored on next open.
 * Keyboard: Enter / Escape / X confirm; Cancel (change-players only) discards.
 */

import { PlayerType } from '../lib/engineConfig.js';
import { getPlayerOptionGroups } from '../lib/playerRegistry.js';
import { playerColorName } from '../lib/playerColors.js';

const PREFS_KEY = 'quoridor-player-prefs-v2';

const STRENGTH_PRESETS = [
  { label: 'Instant',  wallClock: 0.5,  visits: 500,    strengthLevel: 0 },
  { label: 'Fast',     wallClock: 2,    visits: 5000,   strengthLevel: 1 },
  { label: 'Normal',   wallClock: 5,    visits: 20000,  strengthLevel: 2 },
  { label: 'Strong',   wallClock: 15,   visits: 100000, strengthLevel: 3 },
  { label: 'Maximum',  wallClock: 30,   visits: 500000, strengthLevel: 4 },
];

const DEFAULT_WALL_CLOCK = 5;
const WALL_CLOCK_MIN  = 0.5;
const WALL_CLOCK_MAX  = 60;
const WALL_CLOCK_STEP = 0.5;

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function loadPrefs(state) {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return {
      players:       saved.players       ?? [...(state.settings?.players ?? [PlayerType.Human, PlayerType.Human])],
      strengthIndex: saved.strengthIndex ?? [2, 2],
      wallClock:     saved.wallClock     ?? [DEFAULT_WALL_CLOCK, DEFAULT_WALL_CLOCK],
    };
  } catch {
    return {
      players:       [...(state.settings?.players ?? [PlayerType.Human, PlayerType.Human])],
      strengthIndex: [2, 2],
      wallClock:     [DEFAULT_WALL_CLOCK, DEFAULT_WALL_CLOCK],
    };
  }
}

function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

let currentDialog = null;

export function openPlayerDialog(state, controller, { mode = 'newgame' } = {}) {
  if (currentDialog) { currentDialog.remove(); currentDialog = null; }

  const isNewGame = mode === 'newgame';
  const title = isNewGame ? 'New game — choose players' : 'Change players';

  const prefs = loadPrefs(state);
  const selections = {
    players:       [...prefs.players],
    strengthIndex: [...prefs.strengthIndex],
    wallClock:     [...prefs.wallClock],
  };

  const groups = getPlayerOptionGroups();

  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML =
    '<div class="player-dialog" role="dialog" aria-modal="true">' +
      '<div class="player-dialog__header">' +
        '<h2 class="player-dialog__title">' + escHtml(title) + '</h2>' +
        '<button class="player-dialog__close" aria-label="Close" data-action="close">✕</button>' +
      '</div>' +
      '<div class="player-dialog__body">' +
        '<div class="player-dialog__hint">White starts at the bottom and moves upward. Black starts at the top and moves downward.</div>' +
        renderSeatSection(0, selections, groups) +
        renderSeatSection(1, selections, groups) +
      '</div>' +
      '<div class="player-dialog__footer">' +
        '<button class="btn btn--primary player-dialog__start" data-action="start">' +
          (isNewGame ? 'Start game' : 'Apply') +
        '</button>' +
        (!isNewGame ? '<button class="btn player-dialog__cancel" data-action="cancel">Cancel</button>' : '') +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  currentDialog = overlay;

  setTimeout(() => overlay.querySelector('[data-action="start"]')?.focus(), 50);

  // Wire seat selects
  for (const seat of [0, 1]) {
    const sel = overlay.querySelector('[data-seat-select="' + seat + '"]');
    if (sel) {
      sel.addEventListener('change', () => {
        selections.players[seat] = sel.value;
        updateEngineRow(overlay, seat, selections);
      });
    }
    // Preset buttons
    overlay.querySelectorAll('[data-preset-btn][data-seat="' + seat + '"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.presetIndex);
        selections.strengthIndex[seat] = idx;
        // Sync time slider to preset default
        const preset = STRENGTH_PRESETS[idx];
        selections.wallClock[seat] = preset.wallClock;
        const slider = overlay.querySelector('[data-time-slider="' + seat + '"]');
        const label  = overlay.querySelector('[data-time-label="' + seat + '"]');
        if (slider) slider.value = String(preset.wallClock);
        if (label)  label.textContent = formatTime(preset.wallClock);
        overlay.querySelectorAll('[data-preset-btn][data-seat="' + seat + '"]').forEach((b) => {
          b.classList.toggle('btn--primary', Number(b.dataset.presetIndex) === idx);
          b.classList.toggle('btn--ghost',   Number(b.dataset.presetIndex) !== idx);
        });
      });
    });
    // Time slider
    const slider = overlay.querySelector('[data-time-slider="' + seat + '"]');
    const label  = overlay.querySelector('[data-time-label="' + seat + '"]');
    if (slider) {
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        selections.wallClock[seat] = v;
        if (label) label.textContent = formatTime(v);
        // Deselect preset if value no longer matches
        const matchIdx = STRENGTH_PRESETS.findIndex((p) => p.wallClock === v);
        if (matchIdx >= 0) selections.strengthIndex[seat] = matchIdx;
        overlay.querySelectorAll('[data-preset-btn][data-seat="' + seat + '"]').forEach((b) => {
          const bIdx = Number(b.dataset.presetIndex);
          b.classList.toggle('btn--primary', bIdx === matchIdx);
          b.classList.toggle('btn--ghost',   bIdx !== matchIdx);
        });
      });
    }
  }

  const confirm = () => { applyAndClose(); };
  const cancel  = () => { overlay.remove(); currentDialog = null; };

  function applyAndClose() {
    savePrefs({ players: selections.players, strengthIndex: selections.strengthIndex, wallClock: selections.wallClock });
    applySelections(selections, isNewGame, controller, state);
    overlay.remove();
    currentDialog = null;
  }

  overlay.querySelector('[data-action="start"]')?.addEventListener('click', confirm);
  overlay.querySelector('[data-action="close"]')?.addEventListener('click', confirm);
  overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', cancel);

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { e.preventDefault(); confirm(); }
  });

  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) confirm(); });
}

function formatTime(seconds) {
  return seconds < 1 ? seconds + ' s' : (Number.isInteger(seconds) ? seconds : seconds.toFixed(1)) + ' s';
}

function renderSeatSection(seat, selections, groups) {
  const colorName = playerColorName(seat + 1);
  const current   = selections.players[seat];
  const presetIdx = selections.strengthIndex[seat];
  const wc        = selections.wallClock[seat] ?? DEFAULT_WALL_CLOCK;
  const isHuman   = current === PlayerType.Human;

  // Build grouped select
  const opts = groups.map((group) =>
    '<optgroup label="' + escHtml(group.label) + '">' +
    group.options.map((o) =>
      '<option value="' + escHtml(o.value) + '"' +
      (o.value === current ? ' selected' : '') +
      (o.disabled ? ' disabled' : '') + '>' +
      escHtml(o.label) + '</option>'
    ).join('') +
    '</optgroup>'
  ).join('');

  const presets = STRENGTH_PRESETS.map((p, i) =>
    '<button class="btn ' + (i === presetIdx ? 'btn--primary' : 'btn--ghost') + ' btn--small"' +
    ' data-preset-btn data-seat="' + seat + '" data-preset-index="' + i + '"' +
    ' title="' + escHtml(p.label) + ': ~' + p.wallClock + 's">' +
    escHtml(p.label) + '</button>'
  ).join('');

  return (
    '<div class="player-dialog__seat" data-seat-section="' + seat + '">' +
      '<div class="player-dialog__seat-header">' +
        '<div class="pawn-icon pawn-icon--seat' + seat + '"></div>' +
        '<span class="player-dialog__seat-name">' + escHtml(colorName) + '</span>' +
      '</div>' +
      '<div class="player-dialog__field">' +
        '<label class="player-dialog__label" for="seat-select-' + seat + '">Player type</label>' +
        '<select class="player-dialog__select" id="seat-select-' + seat + '" data-seat-select="' + seat + '">' +
          opts +
        '</select>' +
      '</div>' +
      '<div class="player-dialog__field player-dialog__engine-row' + (isHuman ? ' player-dialog__field--hidden' : '') + '" data-engine-row="' + seat + '">' +
        '<label class="player-dialog__label">Strength</label>' +
        '<div class="player-dialog__preset-group">' + presets + '</div>' +
        '<div class="player-dialog__time-row">' +
          '<label class="player-dialog__label">Thinking time: <span class="player-dialog__time-val" data-time-label="' + seat + '">' + formatTime(wc) + '</span></label>' +
          '<input type="range" class="player-dialog__time-slider" data-time-slider="' + seat + '"' +
          ' min="' + WALL_CLOCK_MIN + '" max="' + WALL_CLOCK_MAX + '" step="' + WALL_CLOCK_STEP + '" value="' + wc + '">' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function updateEngineRow(overlay, seat, selections) {
  const playerType = selections.players[seat];
  const isHuman = playerType === PlayerType.Human;
  const row = overlay.querySelector('[data-engine-row="' + seat + '"]');
  if (row) row.classList.toggle('player-dialog__field--hidden', isHuman);
}

function applySelections(selections, isNewGame, controller, state) {
  const [p1Type, p2Type] = selections.players;
  const [p1Idx,  p2Idx]  = selections.strengthIndex;
  const [p1Wc,   p2Wc]   = selections.wallClock;

  const buildAiSettings = (playerType, presetIdx, wallClock) => {
    if (playerType === PlayerType.Human) return null;
    const preset = STRENGTH_PRESETS[presetIdx] ?? STRENGTH_PRESETS[2];
    return {
      wallClockSeconds: wallClock,
      visitsBudget:     preset.visits,
      strengthLevel:    preset.strengthLevel,
      timeToMove:       Math.min(presetIdx, 3),
    };
  };

  const payload = {
    players: [p1Type, p2Type],
    playerAiSettings: [
      buildAiSettings(p1Type, p1Idx, p1Wc),
      buildAiSettings(p2Type, p2Idx, p2Wc),
    ],
  };

  if (isNewGame) {
    controller.newGameWithPlayers?.(payload);
  } else {
    controller.changePlayers?.(payload);
  }
}
