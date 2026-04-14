import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, vi } from "vitest";

beforeAll(() => {
  // React 19 warns when act() expectations are not explicitly enabled.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  window.localStorage?.clear?.();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
  document.body.className = "";
  document.body.removeAttribute("style");
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
