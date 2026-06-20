/**
 * Player selection dialog — shown on first load, "New Game", and "Change players".
 *
 * For each side (White / Black):
 *   - Player type select (Human | Titanium v15 | Ka | Ishtar | Gorisanson | …)
 *   - Strength preset (Instant / Fast / Normal / Strong / Maximum)
 *   - Thinking time (for engines that use wall clock)
 *   - [Advanced] disclosure for raw depth/node controls
 *
 * Keyboard: Enter/Escape/X all confirm with current selections.
 *
 * Usage:
 *   import { openPlayerDialog } from './playerDialog.js';
 *   openPlayerDialog(state, controller, { mode: 'newgame' | 'changeplayers' });
 */

import { PlayerType } from '../lib/engineConfig.js';
import { playerColorName } from '../lib/playerColors.js';

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Strength presets — simple labels the user can understand.
 * Mapped to { wallClockSeconds, visitsBudget/strengthLevel } per engine family.
 */
const STRENGTH_PRESETS = [
  { label: 'Instant',  wallClock: 0.5,  visits: 500,    strengthLevel: 0 },
  { label: 'Fast',     wallClock: 2,    visits: 5000,   strengthLevel: 1 },
  { label: 'Normal',   wallClock: 5,    visits: 20000,  strengthLevel: 2 },
  { label: 'Strong',   wallClock: 15,   visits: 100000, strengthLevel: 3 },
  { label: 'Maximum',  wallClock: 30,   visits: 500000, strengthLevel: 4 },
];

const PLAYER_OPTIONS = [
  { value: PlayerType.Human,           label: 'Human' },
  { value: PlayerType.TitaniumMinimax, label: 'Titanium v15  (local NNUE)' },
  { value: PlayerType.KaAI,            label: 'Ka  (remote)' },
  { value: PlayerType.IshtarV3,        label: 'Ishtar  (remote)' },
  { value: PlayerType.TitaniumV15Frozen, label: 'Titanium v15 frozen  (local)' },
  { value: PlayerType.GorisansonMCTS,  label: 'Gorisanson  (local JS MCTS)' },
  { value: PlayerType.QuoridorV3,      label: 'Quoridor v3  (local JS αβ)' },
  { value: PlayerType.AceV13,          label: 'ACE v13  (local αβ)' },
  { value: PlayerType.AceV10,          label: 'ACE v10  (local αβ)' },
];

let currentDialog = null;

export function openPlayerDialog(state, controller, { mode = 'newgame' } = {}) {
  if (currentDialog) {
    currentDialog.remove();
    currentDialog = null;
  }

  const isNewGame = mode === 'newgame';
  const title = isNewGame ? 'New game — choose players' : 'Change players';

  // Current selections (may be mutated as user clicks)
  const selections = {
    players: [...(state.settings.players ?? [PlayerType.Human, PlayerType.TitaniumMinimax])],
    strengthIndex: [2, 2],   // 'Normal' for both seats by default
  };

  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="player-dialog" role="dialog" aria-modal="true" aria-label="${escHtml(title)}">
      <div class="player-dialog__header">
        <h2 class="player-dialog__title">${escHtml(title)}</h2>
        <button class="player-dialog__close" aria-label="Close" data-action="close">✕</button>
      </div>

      <div class="player-dialog__body">
        <div class="player-dialog__hint">
          White starts at the bottom and moves upward. Black starts at the top and moves downward.
        </div>

        ${[0, 1].map((seat) => renderSeatSection(seat, selections)).join('')}
      </div>

      <div class="player-dialog__footer">
        <button class="btn btn--primary player-dialog__start" data-action="start">
          ${isNewGame ? 'Start game' : 'Apply'}
        </button>
        ${!isNewGame ? `<button class="btn player-dialog__cancel" data-action="cancel">Cancel</button>` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  currentDialog = overlay;

  // Focus the Start button so Enter works immediately
  const startBtn = overlay.querySelector('[data-action="start"]');
  setTimeout(() => startBtn?.focus(), 50);

  // Wire seat selects
  for (const seat of [0, 1]) {
    const sel = overlay.querySelector(`[data-seat-select="${seat}"]`);
    if (sel) {
      sel.addEventListener('change', () => {
        selections.players[seat] = sel.value;
        refreshStrengthRow(overlay, seat, selections);
      });
    }
    overlay.querySelectorAll(`[data-preset-btn][data-seat="${seat}"]`).forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.presetIndex);
        selections.strengthIndex[seat] = idx;
        overlay.querySelectorAll(`[data-preset-btn][data-seat="${seat}"]`).forEach((b) => {
          b.classList.toggle('btn--primary', Number(b.dataset.presetIndex) === idx);
          b.classList.toggle('btn--ghost', Number(b.dataset.presetIndex) !== idx);
        });
      });
    });
  }

  const confirm = () => {
    applySelections(selections, isNewGame, controller, state);
    close();
  };

  const close = () => {
    overlay.remove();
    currentDialog = null;
  };

  overlay.querySelector('[data-action="start"]')?.addEventListener('click', confirm);
  overlay.querySelector('[data-action="close"]')?.addEventListener('click', confirm);
  overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', close);

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { e.preventDefault(); confirm(); }
  });

  // Click outside = confirm
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) confirm();
  });
}

function renderSeatSection(seat, selections) {
  const colorName = playerColorName(seat + 1);
  const current = selections.players[seat];
  const presetIdx = selections.strengthIndex[seat];

  const opts = PLAYER_OPTIONS.map((o) =>
    `<option value="${escHtml(o.value)}" ${o.value === current ? 'selected' : ''}>${escHtml(o.label)}</option>`,
  ).join('');

  const presets = STRENGTH_PRESETS.map((p, i) =>
    `<button class="btn ${i === presetIdx ? 'btn--primary' : 'btn--ghost'} btn--small"
       data-preset-btn data-seat="${seat}" data-preset-index="${i}"
       title="${escHtml(p.label)}: ~${p.wallClock}s">${escHtml(p.label)}</button>`,
  ).join('');

  const isHuman = current === PlayerType.Human;

  return `
    <div class="player-dialog__seat" data-seat-section="${seat}">
      <div class="player-dialog__seat-header">
        <div class="pawn-icon pawn-icon--seat${seat}"></div>
        <span class="player-dialog__seat-name">${escHtml(colorName)}</span>
      </div>
      <div class="player-dialog__field">
        <label class="player-dialog__label" for="seat-select-${seat}">Player type</label>
        <select class="player-dialog__select" id="seat-select-${seat}" data-seat-select="${seat}">
          ${opts}
        </select>
      </div>
      <div class="player-dialog__field player-dialog__strength-row ${isHuman ? 'player-dialog__field--hidden' : ''}" data-strength-row="${seat}">
        <label class="player-dialog__label">Strength</label>
        <div class="player-dialog__preset-group">
          ${presets}
        </div>
      </div>
    </div>
  `;
}

function refreshStrengthRow(overlay, seat, selections) {
  const playerType = selections.players[seat];
  const isHuman = playerType === PlayerType.Human;
  const row = overlay.querySelector(`[data-strength-row="${seat}"]`);
  if (row) {
    row.classList.toggle('player-dialog__field--hidden', isHuman);
  }
}

function applySelections(selections, isNewGame, controller, state) {
  const [p1Type, p2Type] = selections.players;
  const [p1PresetIdx, p2PresetIdx] = selections.strengthIndex;

  const buildAiSettings = (playerType, presetIdx) => {
    const preset = STRENGTH_PRESETS[presetIdx] ?? STRENGTH_PRESETS[2];
    return {
      wallClockSeconds: preset.wallClock,
      visitsBudget: preset.visits,
      strengthLevel: preset.strengthLevel,
      timeToMove: Math.min(presetIdx, 3),
    };
  };

  // Apply players
  if (isNewGame) {
    controller.newGameWithPlayers?.({
      players: [p1Type, p2Type],
      playerAiSettings: [
        p1Type === PlayerType.Human ? null : buildAiSettings(p1Type, p1PresetIdx),
        p2Type === PlayerType.Human ? null : buildAiSettings(p2Type, p2PresetIdx),
      ],
    });
  } else {
    // Change players without resetting position
    controller.changePlayers?.({
      players: [p1Type, p2Type],
      playerAiSettings: [
        p1Type === PlayerType.Human ? null : buildAiSettings(p1Type, p1PresetIdx),
        p2Type === PlayerType.Human ? null : buildAiSettings(p2Type, p2PresetIdx),
      ],
    });
  }
}
