/**
 * Dev-only: native titanium.exe via Vite proxy (Lazy SMP, shared TT).
 * Production GitHub Pages always uses in-browser WASM — never /api/titanium.
 */
import { resolveCores } from './timeControl.js';

export function hasNativeTitaniumLazySmp() {
  if (import.meta.env.PROD) {
    return false;
  }
  return import.meta.env?.VITE_TITANIUM_NATIVE_PROXY === '1';
}

/**
 * Worker count for an actual Titanium search.
 * Native dev: full Lazy SMP via titanium.exe.
 * Browser WASM: one worker until shared-memory Lazy SMP exists — N independent
 * WasmEngine copies panic under load (WebAssembly "unreachable").
 */
export function resolveTitaniumSearchCores(aiSettings) {
  if (hasNativeTitaniumLazySmp()) {
    return resolveCores(aiSettings);
  }
  return 1;
}
