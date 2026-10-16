// The bridge to the Rust side (window.__TAURI__, which Tauri injects). Outside the app (the tests,
// the art preview tools) there is none, so calls quietly do nothing there.
const T = /** @type {any} */ (globalThis).window?.__TAURI__;

/** Call a Rust command (lib.rs, overlay.rs, update.rs, mcp.rs). */
export const invoke = T ? T.core.invoke : async (/** @type {string} */ _cmd, /** @type {any} */ _args) => /** @type {any} */ (null);
/** Listen for an event from the Rust side or another window. */
export const listen = T ? T.event.listen : async (/** @type {string} */ _ev, /** @type {Function} */ _fn) => () => {};
/** Send an event to one window ("overlay", "main"). */
export const emitTo = T ? T.event.emitTo : async (/** @type {string} */ _to, /** @type {string} */ _ev, /** @type {any} */ _payload) => {};
/** This window (show, hide, visibility), when there is one. */
export const currentWindow = () => T?.window.getCurrentWindow();
