/**
 * Static hosting (GitHub Pages) has no Vite Rust proxy — use WASM + in-browser JS workers.
 */
export function useStaticEngineBackend() {
  return import.meta.env.MODE === 'ghpages';
}
