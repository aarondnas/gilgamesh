// What the page's modules expect of the browser, for tests that run in Node.

if (typeof window === "undefined") {
  const media = { matches: false, addEventListener() {}, removeEventListener() {} };
  Object.assign(globalThis, { window: { matchMedia: () => media } });
}
