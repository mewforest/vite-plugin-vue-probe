import { describe, expect, it } from "vitest";
import { resolveDOMElement } from "../src/core/dom";

describe("DOM target resolution", () => {
  it("reports NOT_READY when a selector is used without a DOM", () => {
    expect(() => resolveDOMElement("#card")).toThrowError(
      expect.objectContaining({ code: "NOT_READY" }),
    );
  });
});
