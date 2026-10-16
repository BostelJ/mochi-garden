// Just enough of a browser for the page's modules to load in Node: elements that accept anything,
// a canvas that draws nothing, and no Tauri (tauri.js turns its calls into no-ops). Import this
// before any ui/ module.
const noop = () => {};
const ctx = new Proxy({}, {
  get: (_, k) => (k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : k === 'measureText' ? () => ({ width: 10 }) : noop),
  set: () => true,
});
function el() {
  return new Proxy(
    { classList: { toggle: noop, add: noop, remove: noop, contains: () => false }, style: {}, getContext: () => ctx, width: 0, height: 0, textContent: '', children: [] },
    { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true) },
  );
}
globalThis.document = { createElement: el, querySelector: el, getElementById: el, hasFocus: () => false, hidden: true, fonts: undefined };
globalThis.Image = class {
  complete = false;
  naturalWidth = 0;
};
globalThis.requestAnimationFrame = noop;
