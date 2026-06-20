/**
 * Main entry point — clean game layout
 *
 * Layout (desktop and mobile):
 *   top-card (opponent)
 *   board
 *   bottom-card (active player)
 *   controls
 *   notation bar
 */

import { AppController } from './game/appController.js';
import { renderBoard } from './ui/boardView.js';
import { renderPlayerCard } from './ui/playerCard.js';
import { openPlayerDialog } from './ui/playerDialog.js';
import { renderGameControls, updateNotationBar } from './ui/gameControls.js';

const appRoot = document.getElementById('app');
const controller = new AppController();
if (import.meta.env.DEV) {
  window.__controller = controller;
}

controller._openPlayerDialog = (opts) =>
  openPlayerDialog(controller.getState(), controller, opts);

appRoot.innerHTML =
  '<div class="app-shell">' +
    '<div class="game-layout" id="game-layout">' +
      '<div class="card-slot" id="top-card"></div>' +
      '<div class="board-slot" id="board-slot"></div>' +
      '<div class="card-slot" id="bottom-card"></div>' +
      '<div class="controls-slot" id="controls-slot"></div>' +
      '<div class="notation-slot" id="notation-slot"></div>' +
    '</div>' +
  '</div>';

const topCardEl    = document.getElementById('top-card');
const bottomCardEl = document.getElementById('bottom-card');
const boardSlot    = document.getElementById('board-slot');
const controlsSlot = document.getElementById('controls-slot');
const notationSlot = document.getElementById('notation-slot');

function topSeat(state) {
  return state.settings.rotateBoard ? 0 : 1;
}
function bottomSeat(state) {
  return state.settings.rotateBoard ? 1 : 0;
}

let lastControlsKey = '';
let lastCardKey = '';

function cardKey(state) {
  const ls = state.liveSearch;
  return JSON.stringify({
    players: state.settings.players,
    playerToMove: state.playerToMove,
    thinking: state.aiThinking,
    thinkingSeat: state.thinkingSeatIndex,
    winner: state.winner,
    isDraw: state.isDraw,
    rotated: state.settings.rotateBoard,
    completedSnaps: state.lastCompletedThinkBySeat
      ? state.lastCompletedThinkBySeat.map(function(s) {
          return s ? (s.move + '|' + s.score + '|' + s.depth + '|' + s.nodes + '|' + s.thinkMs) : '';
        })
      : [],
    liveSnap: ls
      ? (ls.mode + '|' + ls.nodes + '|' + ls.elapsedMs + '|' + ls.searchDepth)
      : '',
  });
}

function controlsKey(state) {
  return JSON.stringify({
    canUndo: state.actions.length > 0,
    canRedo: state.canRedo,
    winner: state.winner,
    isDraw: state.isDraw,
    rotated: state.settings.rotateBoard,
    undoPaused: controller._undoPaused,
  });
}

function render() {
  const state = controller.getState();

  renderBoard(boardSlot, state, controller);

  const ck = cardKey(state);
  if (ck !== lastCardKey) {
    renderPlayerCard(topCardEl, state, topSeat(state), controller);
    renderPlayerCard(bottomCardEl, state, bottomSeat(state), controller);
    lastCardKey = ck;
  }

  const ctk = controlsKey(state);
  if (ctk !== lastControlsKey) {
    renderGameControls(controlsSlot, state, controller);
    lastControlsKey = ctk;
  }

  updateNotationBar(notationSlot, state, controller);
}

function renderLiveUpdate() {
  const state = controller.getState();
  const ck = cardKey(state);
  if (ck !== lastCardKey) {
    renderPlayerCard(topCardEl, state, topSeat(state), controller);
    renderPlayerCard(bottomCardEl, state, bottomSeat(state), controller);
    lastCardKey = ck;
  }
}

controller.onChange = render;
controller.onLiveUpdate = renderLiveUpdate;

renderGameControls(controlsSlot, controller.getState(), controller);
render();

const initialState = controller.getState();
const noMoves = initialState.actions.length === 0;
const hasAi = initialState.settings.players.some(function(p) { return p !== 'human'; });
if (noMoves && !hasAi) {
  setTimeout(function() {
    openPlayerDialog(controller.getState(), controller, { mode: 'newgame' });
  }, 100);
}

controller.maybeRequestAiMove();
