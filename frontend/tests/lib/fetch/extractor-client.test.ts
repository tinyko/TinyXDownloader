import { describe, expect, it } from "vitest";

import { isTransientTimelineFetchError } from "@/lib/fetch/extractor-client";

describe("extractor client retry classification", () => {
  it("treats temporary X server failures as transient", () => {
    expect(
      isTransientTimelineFetchError(
        new Error("failed to extract timeline: go-twitter: x api request failed with status 503")
      )
    ).toBe(true);
    expect(
      isTransientTimelineFetchError(
        new Error("go-twitter: x api temporarily unavailable with status 504")
      )
    ).toBe(true);
    expect(
      isTransientTimelineFetchError(
        new Error("failed to extract timeline: go-twitter: x api request failed")
      )
    ).toBe(true);
  });

  it("treats temporary X timeline envelope errors as transient", () => {
    expect(
      isTransientTimelineFetchError(
        new Error("failed to extract timeline: go-twitter: x api returned media timeline errors")
      )
    ).toBe(true);
    expect(
      isTransientTimelineFetchError(new Error("go-twitter: x api returned timeline errors"))
    ).toBe(true);
    expect(
      isTransientTimelineFetchError(new Error("go-twitter: x api returned search timeline errors"))
    ).toBe(true);
  });
});
