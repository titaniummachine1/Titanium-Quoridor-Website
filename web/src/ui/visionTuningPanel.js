/** Live LMR tuning strip when CAT/LMR vision is enabled (viz only). */

function visionTuningStructureKey(state) {
  const s = state.settings ?? {};
  if (!s.showCatVision && !s.showLmrVision) {
    return '';
  }
  if (s.uiMode === 'replay') {
    return '';
  }
  return s.showCatVision ? 'cat' : 'lmr';
}

function syncVisionTuningValues(host, state) {
  const loading = state.catVizLoading || state.lmrVizLoading;
  host.classList.toggle('vision-tuning--refreshing', loading);
}

export function renderVisionTuningPanelHtml(state) {
  // Tuning slider below the board is dev-only; on production it lives in the settings dialog.
  if (!import.meta.env.DEV) {
    return '';
  }
  const settings = state.settings ?? {};
  if (!settings.showCatVision && !settings.showLmrVision) {
    return '';
  }
  if (settings.uiMode === 'replay') {
    return '';
  }
  const hint = settings.showLmrVision
    ? 'Fixed 10-ply LMR plan: v15 baseline plus depth-1 dead-tail/backward overrides.'
    : 'CAT path vision uses the engine heatmap for this position.';

  return `
    <div class="vision-tuning" data-vision-tuning>
      <p class="vision-tuning__title">Vision tuning <span class="vision-tuning__badge">local only</span></p>
      <p class="vision-tuning__hint">${hint}</p>
    </div>`;
}

function wireVisionTuningPanel(host, controller) {
  void host;
  void controller;
}

/** Mount or refresh the live tuning strip above the board controls. Dev builds only. */
export function updateVisionTuningPanel(container, state, controller) {
  let slot = container.querySelector('[data-vision-tuning-root]');
  if (!import.meta.env.DEV) {
    slot?.remove();
    return;
  }
  const structureKey = visionTuningStructureKey(state);
  if (!structureKey) {
    slot?.remove();
    return;
  }
  if (!slot) {
    slot = document.createElement('div');
    slot.dataset.visionTuningRoot = '';
    const boardSlot = container.querySelector('.board-slot') ?? container.querySelector('#board-slot');
    if (boardSlot?.parentElement) {
      boardSlot.insertAdjacentElement('afterend', slot);
    } else {
      container.prepend(slot);
    }
  }
  if (slot.dataset.visionTuningStructure !== structureKey) {
    slot.dataset.visionTuningStructure = structureKey;
    slot.innerHTML = renderVisionTuningPanelHtml(state);
    wireVisionTuningPanel(slot, controller);
  } else {
    syncVisionTuningValues(slot, state);
  }
}
