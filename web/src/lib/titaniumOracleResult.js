/** Three-state Titanium legality oracle outcomes — never conflate with illegal moves. */

export const TitaniumOracleStatus = Object.freeze({
  AVAILABLE: 'available',
  INVALID_POSITION: 'invalid-position',
  UNAVAILABLE: 'unavailable',
});

export function availableTitaniumMoves({ moves, positionKey, source }) {
  return {
    status: TitaniumOracleStatus.AVAILABLE,
    moves: new Set(moves),
    positionKey,
    source,
    error: null,
  };
}

export function unavailableTitaniumOracle({ positionKey, source, error }) {
  return {
    status: TitaniumOracleStatus.UNAVAILABLE,
    moves: null,
    positionKey,
    source,
    error,
  };
}

export function invalidTitaniumPosition({ positionKey, source, error }) {
  return {
    status: TitaniumOracleStatus.INVALID_POSITION,
    moves: null,
    positionKey,
    source,
    error,
  };
}

export function formatTitaniumOracleLine(result) {
  if (!result) {
    return null;
  }
  if (result.status === TitaniumOracleStatus.UNAVAILABLE) {
    const msg = result.error?.message ?? String(result.error ?? 'unknown');
    return `titaniumLegalMoves: UNAVAILABLE (${msg})`;
  }
  if (result.status === TitaniumOracleStatus.INVALID_POSITION) {
    const msg = result.error?.message ?? String(result.error ?? 'invalid position');
    return `titaniumLegalMoves: INVALID_POSITION (${msg})`;
  }
  const moves = [...(result.moves ?? [])].sort();
  return `titaniumLegalMoves (${moves.length}): ${moves.join(' ')}`;
}
