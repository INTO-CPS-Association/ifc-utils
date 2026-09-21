/**
 * A browser for the component tests, made of jsdom.
 *
 * The rest of the suite tests logic and needs no document. The React
 * components render into one, so this puts jsdom's window on the global object
 * before React or MUI load. It is imported first by the files that need it and
 * by no other, so the logic tests keep running in plain Node.
 */

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  // requestAnimationFrame and the layout properties MUI reads.
  pretendToBeVisual: true,
});

const { window } = dom;

// Every property the window has and Node does not. A property Node already
// defines, such as navigator, is replaced through defineProperty, because some
// of them are getters that a plain assignment cannot overwrite.
// window and document are set below as values, since both are read constantly.
const OWN = new Set(['window', 'document']);
for (const key of Object.getOwnPropertyNames(window)) {
  if (OWN.has(key)) continue;
  if (key in globalThis && !['navigator', 'location'].includes(key)) continue;
  Object.defineProperty(globalThis, key, {
    configurable: true,
    get: () => window[key],
  });
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: window });
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  writable: true,
  value: window.document,
});

// In a browser the global object is the window, so code that listens on
// globalThis hears the window's events. These live on the window's prototype,
// which the loop above does not reach, so they are bound to it here.
for (const key of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
  globalThis[key] = window[key].bind(window);
}

// React 19 warns about every update outside act() unless it is told it runs
// under a test environment that wraps them.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
