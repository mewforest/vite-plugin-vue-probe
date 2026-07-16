import { describe, expect, it } from "vitest";
import {
  ProbeOptionsError,
  ProbePathError,
  resolveDetailedValue,
} from "../src/core/path";

describe("resolveDetailedValue", () => {
  it("paginates an array at an exact path", () => {
    const result = resolveDetailedValue(
      { setup: { rows: [1, 2, 3, 4] } },
      ["setup", "rows"],
      { offset: 1, limit: 2 },
    );

    expect(result).toEqual({
      path: ["setup", "rows"],
      value: [2, 3],
      page: {
        offset: 1,
        limit: 2,
        returned: 2,
        total: 4,
        nextOffset: 3,
      },
    });
  });

  it("treats dots and slashes as ordinary key characters", () => {
    const result = resolveDetailedValue({ setup: { "a.b/c": { value: 7 } } }, [
      "setup",
      "a.b/c",
      "value",
    ]);
    expect(result.value).toBe(7);
  });

  it("paginates object keys in Object.keys order", () => {
    const result = resolveDetailedValue(
      { state: { a: 1, b: 2, c: 3 } },
      ["state"],
      { offset: 1, limit: 1 },
    );
    expect(result.value).toEqual({ b: 2 });
    expect(result.page?.nextOffset).toBe(2);
  });

  it("reports a missing path without leaking a native exception", () => {
    expect(() =>
      resolveDetailedValue({ setup: {} }, ["setup", "missing"]),
    ).toThrowError(ProbePathError);
    try {
      resolveDetailedValue({ setup: {} }, ["setup", "missing"]);
    } catch (error) {
      expect(error).toMatchObject({ code: "PATH_NOT_FOUND" });
    }
  });

  it("rejects pagination over the hard limit", () => {
    expect(() => resolveDetailedValue([1], [], { limit: 201 })).toThrowError(
      ProbeOptionsError,
    );
    try {
      resolveDetailedValue([1], [], { limit: 201 });
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_OPTIONS" });
    }
  });

  it("uses maxEntries for nested detail serialization", () => {
    const result = resolveDetailedValue(
      { state: [{ nested: [1, 2, 3] }] },
      ["state"],
      { limit: 1, maxEntries: 2 },
    );
    expect(result.value).toEqual([
      {
        nested: {
          $type: "truncated",
          kind: "array",
          path: ["state", 0, "nested"],
          total: 3,
          returned: 2,
          preview: [1, 2],
          nextOffset: 2,
        },
      },
    ]);
  });

  it("returns a leaf getter failure as an error value", () => {
    const setup = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(setup, "broken", {
      enumerable: true,
      get() {
        throw new Error("getter failed");
      },
    });
    const result = resolveDetailedValue({ setup }, ["setup", "broken"]);
    expect(result.value).toEqual({
      $type: "error",
      name: "Error",
      message: "getter failed",
    });
  });

  it("returns throwing array page entries as error values", () => {
    const rows: unknown[] = [];
    Object.defineProperty(rows, 0, {
      enumerable: true,
      get: () => {
        throw new Error("row failed");
      },
    });
    rows.length = 1;
    expect(resolveDetailedValue({ rows }, ["rows"]).value).toEqual([
      { $type: "error", name: "Error", message: "row failed" },
    ]);
  });

  it("preserves own __proto__ keys in object pages", () => {
    const state = Object.create(null) as Record<string, unknown>;
    state.__proto__ = 7;
    const result = resolveDetailedValue({ state }, ["state"]);
    const parsed = JSON.parse(JSON.stringify(result.value)) as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed.__proto__).toBe(7);
  });
});
