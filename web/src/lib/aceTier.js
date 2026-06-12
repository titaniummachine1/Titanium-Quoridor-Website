/**
 * ACE v10 — one player slot; Version slider names which port runs.
 */

import { StrengthLevel } from './engineConfig.js';

/** Four stops, left → right; labels say exactly what runs. */
export const ACE_V10_STRENGTH_PRESETS = [
  { id: 0, label: 'ACE v10 JS (HTML)' },
  { id: 1, label: 'ACE v10 Rust' },
  { id: 2, label: 'ACE v10 MoveGen+' },
  { id: 3, label: 'ACE v10 MoveGen+ PMC' },
];

const TIERS = [
  {
    kind: 'ace-v10-js',
    engineMode: 'ace-v10-js',
    label: 'ACE v10 JS (HTML)',
    tooltip: 'quoridor (8).html engine in a Web Worker — JS reference',
  },
  {
    kind: 'ace',
    engineMode: 'ace-v10',
    label: 'ACE v10 Rust',
    tooltip: 'Rust 1:1 port — HalfPW eval, iterative deepening',
  },
  {
    kind: 'ace',
    engineMode: 'ace-v10-ti',
    label: 'ACE v10 MoveGen+',
    tooltip: 'Rust port with Titanium legal-move generation in search',
  },
  {
    kind: 'ace',
    engineMode: 'ace-v10-ti-pmc',
    label: 'ACE v10 MoveGen+ PMC',
    tooltip: 'MoveGen+ with pseudo-MCTS root verification between ID depths',
  },
];

/** Map stored strength (incl. legacy Beg/Inter/Adv enum) → tier index 0–3. */
export function normalizeAceV10Strength(strengthLevel) {
  const level = Number(strengthLevel ?? 0);
  if (level <= StrengthLevel.Intermediate) {
    return 0;
  }
  if (level === StrengthLevel.Advanced) {
    return 1;
  }
  if (level === StrengthLevel.Expert) {
    return 2;
  }
  if (level >= StrengthLevel.Alpha) {
    return 3;
  }
  return Math.min(3, Math.max(0, level));
}

export function resolveAceV10Tier(strengthLevel) {
  return TIERS[normalizeAceV10Strength(strengthLevel)];
}

export function aceV10DisplayName(strengthLevel) {
  return resolveAceV10Tier(strengthLevel).label;
}
