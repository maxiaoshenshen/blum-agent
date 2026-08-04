import "@testing-library/jest-dom/vitest";

// jsdom does not implement Element.prototype.scrollIntoView, which the
// component uses to keep the input visible during streaming. Stub it out
// so test assertions don't emit spurious TypeError warnings.
Element.prototype.scrollIntoView = function mock(
  _options?: ScrollIntoViewOptions | boolean,
) {
  // no-op in test environment
};
