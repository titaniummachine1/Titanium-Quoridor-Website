#!/usr/bin/env node
/**
 * Upsert matchup via localhost coordinator (no direct manifest file writes).
 */
'use strict';

const { upsertMatchup } = require('./coordinator_client');

const args = process.argv.slice(2);
function get(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

const engineA = get('--engine-a');
const engineB = get('--engine-b');
const aWins = get('--a-wins');
const bWins = get('--b-wins');
if (!engineA || !engineB || aWins == null || bWins == null) {
  process.stderr.write(
    'usage: node update_matchup.js --engine-a A --engine-b B --a-wins N --b-wins N [--tc-a 5s] [--tc-b 5s]\n',
  );
  process.exit(1);
}

upsertMatchup({
  engineA,
  engineB,
  aWins: Number(aWins),
  bWins: Number(bWins),
  tcA: get('--tc-a'),
  tcB: get('--tc-b'),
  gamesFile: get('--games-file'),
  source: get('--source'),
})
  .then((entry) => {
    if (entry.elo_a_vs_b != null) {
      process.stderr.write(`Elo diff (A vs B): ${entry.elo_a_vs_b}\n`);
    }
  })
  .catch((e) => {
    process.stderr.write(`update_matchup failed: ${e.message}\n`);
    process.exit(1);
  });
