'use strict';
/**
 * Remote Ka/Ishtar presets — matches quoridor-ai.com UI.
 * Strength is always Alpha (full visit budget); only AI Time varies.
 */

/** Wire protocol / CLI names → site UI label */
const TIME_LABELS = {
  intuition: 'Immediate',
  immediate: 'Immediate',
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
};

/** All Ka/Ishtar time presets to benchmark (Alpha strength, varying visits). */
const REMOTE_TIME_MODES = ['intuition', 'short', 'medium', 'long'];

const STRENGTH_NOTE = 'Alpha (max visits for preset)';

function normalizeTimeMode(mode) {
  const m = String(mode || 'short').toLowerCase();
  if (m === 'immediate') return 'intuition';
  return m;
}

function timeLabel(mode) {
  return TIME_LABELS[normalizeTimeMode(mode)] || mode;
}

function presetDescription(opp, mode) {
  return `${opp} · ${STRENGTH_NOTE} · ${timeLabel(mode)}`;
}

module.exports = {
  TIME_LABELS,
  REMOTE_TIME_MODES,
  STRENGTH_NOTE,
  normalizeTimeMode,
  timeLabel,
  presetDescription,
};
