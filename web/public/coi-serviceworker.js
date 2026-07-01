/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, MIT licensed.
 * Enables crossOriginIsolated (SharedArrayBuffer / WASM threads) on hosts that
 * cannot send COOP/COEP headers (e.g. GitHub Pages) by injecting them from a
 * service worker. Uses COEP "credentialless" so cross-origin fetches (zero.ink
 * remote engine, Google Fonts) keep working without requiring CORP headers.
 */
let coepCredentialless = true;
if (typeof window === "undefined") {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("message", (ev) => {
        if (!ev.data) return;
        if (ev.data.type === "deregister") {
            self.registration
                .unregister()
                .then(() => self.clients.matchAll())
                .then((clients) => clients.forEach((client) => client.navigate(client.url)));
        } else if (ev.data.type === "coepCredentialless") {
            coepCredentialless = ev.data.value;
        }
    });

    self.addEventListener("fetch", function (event) {
        const r = event.request;
        if (r.cache === "only-if-cached" && r.mode !== "same-origin") return;

        const request =
            coepCredentialless && r.mode === "no-cors"
                ? new Request(r, { credentials: "omit" })
                : r;
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.status === 0) return response;

                    const newHeaders = new Headers(response.headers);
                    newHeaders.set(
                        "Cross-Origin-Embedder-Policy",
                        coepCredentialless ? "credentialless" : "require-corp"
                    );
                    if (!coepCredentialless) {
                        newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
                    }
                    newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
                .catch((e) => console.error(e))
        );
    });
} else {
    (() => {
        const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
        window.sessionStorage.removeItem("coiReloadedBySelf");
        const coepDegrading = reloadedBySelf === "coepdegrade";

        // You can customize the behavior of this script through a global `coi` variable.
        const coi = {
            shouldRegister: () => !reloadedBySelf,
            shouldDeregister: () => false,
            coepCredentialless: () => true,
            coepDegrade: () => true,
            doReload: () => window.location.reload(),
            quiet: false,
            ...window.coi,
        };

        const n = navigator;
        if (n.serviceWorker && n.serviceWorker.controller) {
            n.serviceWorker.controller.postMessage({
                type: "coepCredentialless",
                value: coi.coepCredentialless(),
            });
        }

        if (!window.crossOriginIsolated && !coepDegrading && coi.shouldRegister() && n.serviceWorker) {
            n.serviceWorker.register(window.document.currentScript.src).then(
                (registration) => {
                    !coi.quiet && console.log("COOP/COEP Service Worker registered", registration.scope);

                    registration.addEventListener("updatefound", () => {
                        !coi.quiet && console.log("Reloading page to make use of updated COOP/COEP Service Worker.");
                        window.sessionStorage.setItem("coiReloadedBySelf", "updatefound");
                        coi.doReload();
                    });

                    // If the registration is active, but it's not controlling the page
                    if (registration.active && !n.serviceWorker.controller) {
                        !coi.quiet && console.log("Reloading page to make use of COOP/COEP Service Worker.");
                        window.sessionStorage.setItem("coiReloadedBySelf", "notcontrolling");
                        coi.doReload();
                    }

                    // Some browsers report the registration before `active` is
                    // populated on the first visit. Reload when the worker is
                    // actually ready so SharedArrayBuffer is available before
                    // the WASM engine starts.
                    n.serviceWorker.ready.then(() => {
                        if (!n.serviceWorker.controller && !window.crossOriginIsolated) {
                            !coi.quiet && console.log("Reloading page after COOP/COEP Service Worker became ready.");
                            window.sessionStorage.setItem("coiReloadedBySelf", "ready");
                            coi.doReload();
                        }
                    });
                },
                (err) => {
                    !coi.quiet && console.error("COOP/COEP Service Worker failed to register:", err);
                }
            );
        }
    })();
}
