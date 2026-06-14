/**
 * Static hosting (GitHub Pages) has no Vite Rust proxy.
 * - ACE JS tiers: in-browser JS workers (vendor extract)
 * - ACE Rust / MoveGen+ / Titanium: Rust compiled to WASM (not .exe)
 */
export function useStaticEngineBackend() {
  return import.meta.env.MODE === 'ghpages';
}
