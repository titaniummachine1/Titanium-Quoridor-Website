/** Injected at CI build time (VITE_BUILD_SHA); helps verify GitHub Pages cache. */
export const BUILD_SHA = String(import.meta.env.VITE_BUILD_SHA ?? 'dev').slice(0, 7);
export const BUILD_LABEL = `build ${BUILD_SHA}`;
