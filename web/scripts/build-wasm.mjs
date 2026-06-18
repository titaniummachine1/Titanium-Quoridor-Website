/**
 * Compile monorepo engine (Rust) → web/src/wasm/titanium for GitHub Pages.
 * Uses ../../engine (canonical v15 + net_weights.bin), not stale site/engine submodule.
 * Requires: rustup target add wasm32-unknown-unknown, cargo install wasm-pack
 *
 * Native `titanium.exe` must use RUSTFLAGS=-C target-cpu=native (BMI2/PEXT movegen).
 * Wasm is wasm32-unknown-unknown — never pass host CPU flags here; PEXT is cfg-gated
 * off on non-x86 and the browser uses the scalar O1 table path + embed-tables.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const monorepoEngine = path.resolve(webDir, '..', '..', 'engine');
const siteEngine = path.resolve(webDir, '..', 'engine');
const outDir = path.join(webDir, 'src', 'wasm', 'titanium');

const engineDir = existsSync(path.join(monorepoEngine, 'src', 'wasm.rs'))
  ? monorepoEngine
  : siteEngine;
console.log(`[build:wasm] engine dir: ${engineDir}`);

const wasmBindgen =
  process.env.WASM_BINDGEN ||
  (process.platform === 'win32'
    ? path.join(process.env.USERPROFILE ?? '', '.cargo', 'bin', 'wasm-bindgen.exe')
    : 'wasm-bindgen');

// Strip inherited RUSTFLAGS (e.g. target-cpu=native from training guards) — invalid for wasm32.
const { RUSTFLAGS: _dropNativeRustflags, ...hostEnv } = process.env;
const env = { ...hostEnv, WASM_BINDGEN: wasmBindgen };

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
    'wasm,embed-tables',
  ],
  { cwd: engineDir, stdio: 'inherit', env },
);

process.exit(result.status ?? 1);
