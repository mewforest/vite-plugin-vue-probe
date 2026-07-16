import { describe, expect, it } from "vitest";
import {
  ProbePathError,
  resolveDetailedValue,
} from "../src/core/path";
import {
  HARD_MAX_OFFSET,
  HARD_MAX_PATH_SEGMENT_LENGTH,
  HARD_MAX_PATH_SEGMENTS,
  ProbeOptionsError,
} from "../src/core/contract";

describe("resolveDetailedValue", () => {
  it.each([
    ["array", (huge: unknown) => [huge, "second"]],
    ["object", (huge: unknown) => ({ first: huge, second: "second" })],
    ["map", (huge: unknown) => new Map([["first", huge], ["second", 2]])],
    ["set", (huge: unknown) => new Set([huge, "second"])],
  ])("does not advance a %s page when the delivered payload contains no item", (_name, collection) => {
    const huge = Array.from({ length: 200 }, () =>
      Array.from({ length: 200 }, () => 1),
    );
    const result = resolveDetailedValue({ collection: collection(huge) }, ["collection"], {
      limit: 2,
      maxDepth: 20,
      maxEntries: 200,
    });

    expect(result.value).toMatchObject({
      $type: "truncated",
      returned: 0,
      reason: "node-budget",
    });
    expect(result.page).toEqual({
      offset: 0,
      limit: 2,
      returned: 0,
      total: 2,
      nextOffset: null,
    });
  });

  it.each([
    ["array", (marker: unknown) => [marker, "next"]],
    ["object", (marker: unknown) => ({ first: marker, second: "next" })],
    ["map", (marker: unknown) => new Map([["first", marker], ["second", "next"]])],
    ["set", (marker: unknown) => new Set([marker, "next"])],
  ])("does not treat a legitimate user %s marker collision as pagination control", (_name, collection) => {
    const marker = {
      $type: "truncated",
      kind: "object",
      path: ["user"],
      total: 0,
      returned: 0,
      preview: null,
      nextOffset: null,
      reason: "node-budget",
    };
    const result = resolveDetailedValue({ collection: collection(marker) }, ["collection"], {
      limit: 2,
      maxDepth: 20,
      maxEntries: 20,
    });

    expect(result.page).toMatchObject({ returned: 2, nextOffset: null });
  });

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

  it("paginates Map and Set values without materializing the collection", () => {
    expect(
      resolveDetailedValue(
        { state: new Map([["a", 1], ["b", 2], ["c", 3]]) },
        ["state"],
        { offset: 1, limit: 1 },
      ),
    ).toEqual({
      path: ["state"],
      value: {
        $type: "map",
        size: 3,
        entries: [["b", 2]],
        returned: 1,
        nextOffset: 2,
      },
      page: { offset: 1, limit: 1, returned: 1, total: 3, nextOffset: 2 },
    });
    expect(
      resolveDetailedValue({ state: new Set([1, 2, 3]) }, ["state"], {
        offset: 2,
        limit: 2,
      }),
    ).toEqual({
      path: ["state"],
      value: {
        $type: "set",
        size: 3,
        values: [3],
        returned: 1,
        nextOffset: null,
      },
      page: { offset: 2, limit: 2, returned: 1, total: 3, nextOffset: null },
    });
  });

  it("fast-returns Map/Set pages beyond size without creating iterators", () => {
    const map = new Map([["a", 1]]);
    const set = new Set([1]);
    map.entries = () => {
      throw new Error("map iterator must not be created");
    };
    set.values = () => {
      throw new Error("set iterator must not be created");
    };
    expect(resolveDetailedValue({ map }, ["map"], { offset: 1 })).toMatchObject({
      value: { $type: "map", entries: [], returned: 0, nextOffset: null },
      page: { returned: 0, nextOffset: null },
    });
    expect(resolveDetailedValue({ set }, ["set"], { offset: 1 })).toMatchObject({
      value: { $type: "set", values: [], returned: 0, nextOffset: null },
      page: { returned: 0, nextOffset: null },
    });
  });

  it("uses iterator lookahead for detail continuation", () => {
    const map = new Map([["a", 1], ["b", 2]]);
    const entries = map.entries.bind(map);
    map.entries = () => {
      const iterator = entries();
      const next = iterator.next.bind(iterator);
      let calls = 0;
      iterator.next = () => {
        const item = next();
        calls += 1;
        if (calls === 1) map.delete("b");
        return item;
      };
      return iterator;
    };
    expect(
      resolveDetailedValue({ map }, ["map"], { limit: 1 }),
    ).toMatchObject({
      value: { returned: 1, nextOffset: null },
      page: { returned: 1, nextOffset: null },
    });
  });

  it("rejects unsafe detail offsets", () => {
    expect(() =>
      resolveDetailedValue([], [], { offset: HARD_MAX_OFFSET + 1 }),
    ).toThrowError(ProbeOptionsError);
  });

  it("follows synthetic Map/Set paths emitted by nested truncation", () => {
    const mapValue = { nested: { value: 1 } };
    const setValue = { nested: { value: 2 } };
    const root = {
      map: new Map([["key", mapValue]]),
      set: new Set([setValue]),
    };
    const mapSerialized = resolveDetailedValue(root, ["map"], {
      maxDepth: 0,
      limit: 1,
    }).value;
    const setSerialized = resolveDetailedValue(root, ["set"], {
      maxDepth: 0,
      limit: 1,
    }).value;
    expect(mapSerialized).toMatchObject({
      entries: [["key", { $type: "truncated", path: ["map", 0, "value"] }]],
    });
    expect(setSerialized).toMatchObject({
      values: [{ $type: "truncated", path: ["set", 0] }],
    });
    expect(resolveDetailedValue(root, ["map", 0, "value"]).value).toEqual(
      mapValue,
    );
    expect(resolveDetailedValue(root, ["set", 0]).value).toEqual(setValue);
  });

  it("distinguishes an undefined Set value from an out-of-range index", () => {
    const root = { set: new Set([undefined]) };
    expect(resolveDetailedValue(root, ["set", 0]).value).toEqual({
      $type: "undefined",
    });
    expect(() => resolveDetailedValue(root, ["set", 1])).toThrowError(
      ProbePathError,
    );
  });

  it("rejects oversized and out-of-range synthetic indices before iteration", () => {
    let mapIterations = 0;
    let setIterations = 0;
    const map = new Map([["key", 1]]);
    const set = new Set([1]);
    map.entries = () => {
      mapIterations += 1;
      throw new Error("must not iterate");
    };
    set.values = () => {
      setIterations += 1;
      throw new Error("must not iterate");
    };

    expect(() => resolveDetailedValue({ map }, ["map", 1])).toThrowError(
      ProbePathError,
    );
    expect(() =>
      resolveDetailedValue({ set }, ["set", HARD_MAX_OFFSET + 1]),
    ).toThrowError(ProbeOptionsError);
    expect(mapIterations).toBe(0);
    expect(setIterations).toBe(0);
  });

  it("clamps every detail error value to maxStringLength", () => {
    const longMessage = "x".repeat(100);
    const root = new Proxy(
      { value: 1 },
      {
        getOwnPropertyDescriptor() {
          throw new TypeError(longMessage);
        },
      },
    );
    expect(
      resolveDetailedValue(root, ["value"], { maxStringLength: 8 }).value,
    ).toEqual({
      $type: "error",
      name: "TypeErro",
      message: "xxxxxxxx",
    });

    const map = new Map([["key", 1]]);
    map.entries = () => {
      throw new RangeError(longMessage);
    };
    expect(
      resolveDetailedValue({ map }, ["map"], { maxStringLength: 8 }).value,
    ).toEqual({
      $type: "error",
      name: "RangeErr",
      message: "xxxxxxxx",
    });

    expect(
      resolveDetailedValue({ date: new Date(Number.NaN) }, ["date"], {
        maxStringLength: 4,
      }).value,
    ).toEqual({
      $type: "error",
      name: "Rang",
      message: "Inva",
    });
  });

  it("keeps every page cursor and synthetic path addressable at offset boundary", () => {
    const array: unknown[] = [];
    array.length = HARD_MAX_OFFSET + 2;
    array[HARD_MAX_OFFSET] = "boundary";
    const text = `${"x".repeat(HARD_MAX_OFFSET)}ab`;

    class VirtualMap extends Map<number, { value: number }> {
      override get size() {
        return HARD_MAX_OFFSET + 2;
      }
      override entries(): MapIterator<[number, { value: number }]> {
        let index = 0;
        return {
          next() {
            if (index >= HARD_MAX_OFFSET + 2)
              return { done: true, value: undefined };
            const value: [number, { value: number }] = [index, { value: index }];
            index += 1;
            return { done: false, value };
          },
          [Symbol.iterator]() {
            return this;
          },
          [Symbol.dispose]() {},
        };
      }
    }
    class VirtualSet extends Set<{ value: number }> {
      override get size() {
        return HARD_MAX_OFFSET + 2;
      }
      override values(): SetIterator<{ value: number }> {
        let index = 0;
        return {
          next() {
            if (index >= HARD_MAX_OFFSET + 2)
              return { done: true, value: undefined };
            const value = { value: index };
            index += 1;
            return { done: false, value };
          },
          [Symbol.iterator]() {
            return this;
          },
          [Symbol.dispose]() {},
        };
      }
    }

    const root = {
      array,
      text,
      object: { only: 1 },
      map: new VirtualMap(),
      set: new VirtualSet(),
    };
    for (const key of ["array", "text", "object", "map", "set"] as const) {
      const result = resolveDetailedValue(root, [key], {
        offset: HARD_MAX_OFFSET,
        limit: 2,
      });
      expect(result.page?.nextOffset).toBeNull();
      expect(result.page?.returned).toBeLessThanOrEqual(1);
    }
    expect(resolveDetailedValue(root, ["map", HARD_MAX_OFFSET, "value"]).value)
      .toEqual({ value: HARD_MAX_OFFSET });
    expect(resolveDetailedValue(root, ["set", HARD_MAX_OFFSET]).value).toEqual({
      value: HARD_MAX_OFFSET,
    });
  });

  it("rejects oversized public paths and bounds path error rendering", () => {
    expect(() =>
      resolveDetailedValue({}, Array.from({ length: HARD_MAX_PATH_SEGMENTS + 1 }, () => "x")),
    ).toThrowError(ProbeOptionsError);
    expect(() =>
      resolveDetailedValue({}, ["x".repeat(HARD_MAX_PATH_SEGMENT_LENGTH + 1)]),
    ).toThrowError(ProbeOptionsError);
    expect(() =>
      resolveDetailedValue({}, ["x".repeat(60_000), "y".repeat(60_000)]),
    ).toThrowError(ProbeOptionsError);
    try {
      resolveDetailedValue({}, ["x".repeat(HARD_MAX_PATH_SEGMENT_LENGTH)], {
        maxStringLength: 20,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ProbePathError);
      expect((error as Error).message.length).toBeLessThanOrEqual(20);
    }
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

  it("rejects inherited properties and invalid numeric array indices", () => {
    const inherited = Object.create({ secret: 1 }) as Record<string, unknown>;
    const array = [1] as unknown[] & Record<number, unknown>;
    array[2 ** 32 - 1] = "not-an-array-index";
    expect(() => resolveDetailedValue(inherited, ["secret"])).toThrowError(
      ProbePathError,
    );
    expect(() => resolveDetailedValue([1], [-1])).toThrowError(
      ProbeOptionsError,
    );
    expect(() => resolveDetailedValue([1], [0.5])).toThrowError(
      ProbeOptionsError,
    );
    expect(() => resolveDetailedValue(array, [2 ** 32 - 1])).toThrowError(
      ProbeOptionsError,
    );
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

  it("counts ordinary object pages that contain a user-defined $type key", () => {
    const result = resolveDetailedValue(
      { state: { $type: "application-value", answer: 42 } },
      ["state"],
      { limit: 2 },
    );

    expect(result.value).toEqual({
      $type: "application-value",
      answer: 42,
    });
    expect(result.page).toEqual({
      offset: 0,
      limit: 2,
      returned: 2,
      total: 2,
      nextOffset: null,
    });
  });

  it("turns throwing Proxy enumeration and reads into error values", () => {
    const enumerationFailure = new Proxy(
      {},
      {
        ownKeys() {
          throw new TypeError("ownKeys failed");
        },
      },
    );
    expect(resolveDetailedValue(enumerationFailure, []).value).toEqual({
      $type: "error",
      name: "TypeError",
      message: "ownKeys failed",
    });

    const readFailure = new Proxy(
      { value: 1 },
      {
        getOwnPropertyDescriptor() {
          throw new TypeError("descriptor failed");
        },
      },
    );
    expect(resolveDetailedValue(readFailure, ["value"]).value).toEqual({
      $type: "error",
      name: "TypeError",
      message: "descriptor failed",
    });
  });
});
