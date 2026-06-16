#!/usr/bin/env node
/**
 * Upsert one game via localhost coordinator.
 * Usage: node ingest_game.js <games-file> [--tag NAME]
 *        (reads last GAME/RESULT pair from file tail, or pass via stdin in future)
 */
'use strict';

const fs = require('fs');
const { upsertGame } = require('./coordinator_client');

const gamesFile = process.argv[2];
const tagIdx = process.argv.indexOf('--tag');
const tag = tagIdx >= 0 ? process.argv[tagIdx + 1] : null;

if (!gamesFile) {
  process.stderr.write('usage: node ingest_game.js <games-file> [--tag NAME]\n');
  process.exit(1);
}

const text = fs.readFileSync(gamesFile, 'utf8');
const lines = text.trim().split(/\r?\n/);
let moves = null;
let result = null;
for (let i = lines.length - 1; i >= 0; i--) {
  const line = lines[i].trim();
  if (!result && line.startsWith('RESULT ')) {
    result = line.split(/\s+/)[1];
  } else if (!moves && line.startsWith('GAME ')) {
    moves = line.split(/\s+/).slice(1);
    if (result) break;
  }
}

if (!moves || !result || !['W', 'B'].includes(result)) {
  process.stderr.write('ingest_game: no GAME/RESULT found in file\n');
  process.exit(1);
}

upsertGame({ moves, result, tag, gamesFile })
  .catch((e) => {
    process.stderr.write(`ingest_game failed: ${e.message}\n`);
    process.exit(1);
  });
