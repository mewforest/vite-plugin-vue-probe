import { describe, expect, it } from "vitest";
import { ProbeOptionsError, serializeProbeValue } from "../src/core/serializer";

describe("serializeProbeValue", () => {
  it("keeps JSON primitives and represents non-JSON primitives explicitly", () => {
    expect(serializeProbeValue(undefined)).toEqual({ $type: "undefined" });
    expect(serializeProbeValue(Number.NaN)).toEqual({
      $type: "number",
      value: "NaN",
    });
    expect(serializeProbeValue(Number.POSITIVE_INFINITY)).toEqual({
      $type: "number",
      value: "Infinity",
    });
    expect(serializeProbeValue(42n)).toEqual({ $type: "bigint", value: "42" });
    expect(serializeProbeValue(new Date("2026-07-15T10:00:00.000Z"))).toEqual({
      $type: "date",
      value: "2026-07-15T10:00:00.000Z",
    });
  });

  it("truncates arrays using an addressable path and entry budget", () => {
    expect(
      serializeProbeValue([1, 2, 3], {
        maxEntries: 2,
        path: ["setup", "rows"],
      }),
    ).toEqual({
      $type: "truncated",
      kind: "array",
      path: ["setup", "rows"],
      total: 3,
      returned: 2,
      preview: [1, 2],
      nextOffset: 2,
    });
  });

  it("truncates long strings and objects without losing retrieval metadata", () => {
    expect(
      serializeProbeValue("abcdef", {
        maxStringLength: 3,
        path: ["data", "text"],
      }),
    ).toEqual({
      $type: "truncated",
      kind: "string",
      path: ["data", "text"],
      total: 6,
      returned: 3,
      preview: "abc",
      nextOffset: 3,
    });

    expect(
      serializeProbeValue(
        { a: 1, b: 2 },
        { maxEntries: 1, path: ["setup", "record"] },
      ),
    ).toEqual({
      $type: "truncated",
      kind: "object",
      path: ["setup", "record"],
      total: 2,
      returned: 1,
      preview: { a: 1 },
      nextOffset: 1,
    });
  });

  it("represents cycles, Map, Set, and Error as JSON-safe values", () => {
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;

    expect(serializeProbeValue(cyclic)).toEqual({
      name: "root",
      self: { $type: "circular-reference", targetPath: [] },
    });
    expect(serializeProbeValue(new Map([["a", 1]]))).toEqual({
      $type: "map",
      size: 1,
      entries: [["a", 1]],
    });
    expect(serializeProbeValue(new Set([1, 2]))).toEqual({
      $type: "set",
      size: 2,
      values: [1, 2],
    });
    expect(serializeProbeValue(new TypeError("broken"))).toEqual({
      $type: "error",
      name: "TypeError",
      message: "broken",
    });
    expect(() => JSON.stringify(serializeProbeValue(cyclic))).not.toThrow();
  });

  it("stops descending at maxDepth", () => {
    expect(
      serializeProbeValue({ nested: { value: 1 } }, { maxDepth: 1 }),
    ).toEqual({
      nested: {
        $type: "truncated",
        kind: "object",
        path: ["nested"],
        total: 1,
        returned: 0,
        preview: {},
        nextOffset: 0,
      },
    });
  });

  it("rejects invalid budgets and the hard entry limit", () => {
    expect(() => serializeProbeValue([], { maxEntries: 201 })).toThrowError(
      ProbeOptionsError,
    );
    expect(() => serializeProbeValue([], { maxEntries: -1 })).toThrowError(
      ProbeOptionsError,
    );
    expect(() =>
      serializeProbeValue([], { maxDepth: Number.NaN }),
    ).toThrowError(ProbeOptionsError);
    expect(() => serializeProbeValue("", { maxStringLength: 0 })).toThrowError(
      ProbeOptionsError,
    );
  });

  it("turns throwing array accessors into error values", () => {
    const array: unknown[] = [];
    Object.defineProperty(array, 0, {
      enumerable: true,
      get() {
        throw new TypeError("array getter failed");
      },
    });
    array.length = 1;

    expect(serializeProbeValue(array)).toEqual([
      {
        $type: "error",
        name: "TypeError",
        message: "array getter failed",
      },
    ]);
  });

  it("preserves own __proto__ keys as JSON data", () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.__proto__ = { safe: true };
    const serialized = serializeProbeValue(value);
    const parsed = JSON.parse(JSON.stringify(serialized)) as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed.__proto__).toEqual({ safe: true });
  });
});
