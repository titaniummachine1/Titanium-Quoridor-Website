/**
 * Canonical engine backend kinds — local and remote paths must never mix.
 */

export const EngineBackendKind = Object.freeze({
  HUMAN: 'human',
  LOCAL_JS: 'local-js',
  LOCAL_WASM: 'local-wasm',
  REMOTE_WS: 'remote-ws',
});

export function isLocalEngineBackend(kind) {
  return kind === EngineBackendKind.LOCAL_JS || kind === EngineBackendKind.LOCAL_WASM;
}

export function isRemoteEngineBackend(kind) {
  return kind === EngineBackendKind.REMOTE_WS;
}

/** Static hosting / production dist has no Vite Rust proxy. */
export function useStaticEngineBackend() {
  if (import.meta.env?.MODE === 'ghpages') {
    return true;
  }
  if (import.meta.env?.PROD) {
    return true;
  }
  return false;
}
