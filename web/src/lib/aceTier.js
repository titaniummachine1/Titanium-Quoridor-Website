/**
 * ACE v8 / v10 / v13 — player dropdown picks generation; Version slider picks tier 0–3.
 * v13 is pure without EME (only JS, Rust, MoveGen+ tiers).
 */

import { PlayerType, StrengthLevel } from './engineConfig.js';

function buildPresets(generation) {
  return [
    { id: 0, label: `ACE v${generation} JS (HTML)` },
    { id: 1, label: `ACE v${generation} Rust` },
    { id: 2, label: `ACE v${generation} MoveGen+` },
    { id: 3, label: `ACE v${generation} MoveGen+ EME` },
  ];
}

function buildPresetsV13() {
  return [
    { id: 0, label: `ACE v13 JS (HTML)` },
    { id: 1, label: `ACE v13 Rust` },
    { id: 2, label: `ACE v13 MoveGen+` },
  ];
}

export const ACE_V8_STRENGTH_PRESETS = buildPresets(8);
export const ACE_V10_STRENGTH_PRESETS = buildPresets(10);
export const ACE_V13_STRENGTH_PRESETS = buildPresetsV13();

function buildTiers(generation) {
  const prefix = `ace-v${generation}`;
  return [
    {
      kind: `${prefix}-js`,
      engineMode: `${prefix}-js`,
      label: `ACE v${generation} JS (HTML)`,
      tooltip: `quoridor (8).html engine — JS reference (v${generation})`,
    },
    {
      kind: 'ace',
      engineMode: prefix,
      label: `ACE v${generation} Rust`,
      tooltip: `Rust port — HalfPW eval, iterative deepening (v${generation})`,
    },
    {
      kind: 'ace',
      engineMode: `${prefix}-ti`,
      label: `ACE v${generation} MoveGen+`,
      tooltip: `Rust port with Titanium legal-move generation in search (v${generation})`,
    },
    {
      kind: 'ace',
      engineMode: `${prefix}-ti-pmc`,
      label: `ACE v${generation} MoveGen+ EME`,
      tooltip: `MoveGen+ with Early Move Extensions on first ordered wall moves (v${generation})`,
    },
  ];
}

function buildTiersV13() {
  const prefix = 'ace-v13';
  return [
    {
      kind: `${prefix}-js`,
      engineMode: `${prefix}-js`,
      label: `ACE v13 JS (HTML)`,
      tooltip: `ACEV13.html engine — JS reference (v13)`,
    },
    {
      kind: 'ace',
      engineMode: prefix,
      label: `ACE v13 Rust`,
      tooltip: `Rust port — HalfPW eval, iterative deepening (v13)`,
    },
    {
      kind: 'ace',
      engineMode: `${prefix}-ti`,
      label: `ACE v13 MoveGen+`,
      tooltip: `Rust port with Titanium legal-move generation in search (v13)`,
    },
  ];
}

const TIERS_BY_GENERATION = {
  8: buildTiers(8),
  10: buildTiers(10),
  13: buildTiersV13(),
};

/** Which ACE generation this player slot uses (8, 10, or 13). */
export function aceGenerationFromPlayerType(playerType) {
  if (playerType === PlayerType.AceV8) return 8;
  if (playerType === PlayerType.AceV13) return 13;
  if (playerType === PlayerType.AceV10) return 10;
  return 13;
}

export function aceStrengthPresetsForPlayerType(playerType) {
  const generation = aceGenerationFromPlayerType(playerType);
  if (generation === 8) return ACE_V8_STRENGTH_PRESETS;
  if (generation === 13) return ACE_V13_STRENGTH_PRESETS;
  return ACE_V10_STRENGTH_PRESETS;
}

/** Slider stores tier index 0–3 (v8/v10) or 0–2 (v13) — clamp only, no remapping. */
export function clampAceV10Tier(strengthLevel, playerType) {
  const tier = Math.trunc(Number(strengthLevel ?? 0));
  const maxTier = playerType === PlayerType.AceV13 ? 2 : 3;
  return Math.min(maxTier, Math.max(0, tier));
}

/** Legacy saves used StrengthLevel 0–4 (Alpha); map those once for display/load. */
export function migrateAceV10Strength(strengthLevel) {
  const level = Math.trunc(Number(strengthLevel ?? 0));
  if (level >= 0 && level <= 3) {
    return level;
  }
  if (level === StrengthLevel.Alpha) {
    return 3;
  }
  if (level === StrengthLevel.Expert) {
    return 2;
  }
  if (level === StrengthLevel.Advanced) {
    return 1;
  }
  return 0;
}

export function resolveAceTier(strengthLevel, playerTypeOrGeneration) {
  const generation =
    typeof playerTypeOrGeneration === 'number'
      ? playerTypeOrGeneration
      : aceGenerationFromPlayerType(playerTypeOrGeneration);
  const tiers = TIERS_BY_GENERATION[generation] ?? TIERS_BY_GENERATION[13];
  const playerType = typeof playerTypeOrGeneration === 'number' ? PlayerType.AceV13 : playerTypeOrGeneration;
  return tiers[clampAceV10Tier(migrateAceV10Strength(strengthLevel), playerType)];
}

export function aceDisplayName(strengthLevel, playerType) {
  return resolveAceTier(strengthLevel, playerType).label;
}

/** @deprecated use resolveAceTier(strengthLevel, PlayerType.AceV10) */
export function resolveAceV10Tier(strengthLevel) {
  return resolveAceTier(strengthLevel, 10);
}

/** @deprecated use aceDisplayName(strengthLevel, playerType) */
export function aceV10DisplayName(strengthLevel) {
  return aceDisplayName(strengthLevel, PlayerType.AceV10);
}

/** Default site matchup: White v13 MoveGen+ vs Black v13 JS, 2s per move. */
export const ACE_COMPARE_WALL_CLOCK_SEC = 2;
export const ACE_TIER_JS = 0;
/** v10 only — MoveGen+ EME (tier 3). */
export const ACE_TIER_EME = 3;
/** v13 top tier — MoveGen+ (replaces v10 EME in default compare). */
export const ACE_TIER_MOVEGEN_PLUS = 2;

export function defaultAceCompareAiSettings() {
  const clock = ACE_COMPARE_WALL_CLOCK_SEC;
  return [
    { strengthLevel: ACE_TIER_MOVEGEN_PLUS, wallClockSeconds: clock },
    { strengthLevel: ACE_TIER_JS, wallClockSeconds: clock },
  ];
}
