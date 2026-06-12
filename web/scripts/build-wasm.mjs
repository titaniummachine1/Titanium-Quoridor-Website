/**
 * Compile site/engine (Rust) → web/src/wasm/titanium for GitHub Pages.
 * Requires: rustup target add wasm32-unknown-unknown, cargo install wasm-pack
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const engineDir = path.resolve(webDir, '..', 'engine');
const outDir = path.join(webDir, 'src', 'wasm', 'titanium');

// Cargo flags (--no-default-features, --features) must follow `--` or wasm-pack
// forwards --out-dir/--out-name to cargo and the build fails on modern toolchains.
const result = spawnSync(
  'wasm-pack',
  [
    'build',
    '--release',
    '--target',
    'web',
    '--out-dir',
    outDir,
    '--out-name',
    'titanium',
    '--',
    '--no-default-features',
    '--features',
    'wasm',
  ],
  { cwd: engineDir, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
