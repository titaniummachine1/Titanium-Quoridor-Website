#!/usr/bin/env node
/**
 * Incremental ingest helper — called by self_match.js after each game.
 * Usage: node site/ingest_game.js <games-file> [--tag NAME]
 */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const gamesFile = process.argv[2];
const tagIdx = process.argv.indexOf('--tag');
const tag = tagIdx >= 0 ? process.argv[tagIdx + 1] : null;

if (!gamesFile) {
  process.stderr.write('usage: node ingest_game.js <games-file> [--tag NAME]\n');
  process.exit(1);
}

const datagen = path.resolve(__dirname, '../training/datagen.py');
const dbPath = path.resolve(__dirname, '../training/data/all_games.jsonl');
const args = [
  datagen,
  '--incremental', gamesFile,
  '--out', dbPath,
];
if (tag) args.push('--tag', tag);

const r = spawnSync('python', args, { encoding: 'utf8' });
if (r.stdout) process.stderr.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
process.exit(r.status ?? 1);
