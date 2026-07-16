import { describe, expect, it } from "vitest";
import {
  HARD_MAX_ENTRIES,
  HARD_MAX_DEPTH,
  HARD_MAX_PATH_SEGMENT_LENGTH,
  HARD_MAX_NODES,
  HARD_MAX_STRING_LENGTH,
  HARD_MAX_TOTAL_STRING_LENGTH,
  ProbeOptionsError,
} from "../src/core/contract";
import {
  boundProbePayload,
  createProbePayloadBudget,
  createSerializationContext,
  serializeProbeValue,
} from "../src/core/serializer";

describe("serializeProbeValue", () => {
  it("uses hard per-value defaults when soft budgets are bypassed", () => {
    expect(createSerializationContext({ bypassBudgets: true }).options).toEqual({
      maxDepth: HARD_MAX_DEPTH,
      maxEntries: HARD_MAX_ENTRIES,
      maxStringLength: HARD_MAX_STRING_LENGTH,
    });
  });

  it("keeps explicit budgets when soft budgets are bypassed", () => {
    expect(
      createSerializationContext({
        bypassBudgets: true,
        maxDepth: 4,
        maxEntries: 30,
        maxStringLength: 900,
      }).options,
    ).toEqual({ maxDepth: 4, maxEntries: 30, maxStringLength: 900 });
  });

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
      returned: 1,
      nextOffset: null,
    });
    expect(serializeProbeValue(new Set([1, 2]))).toEqual({
      $type: "set",
      size: 2,
      values: [1, 2],
      returned: 2,
      nextOffset: null,
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
    expect(() =>
      serializeProbeValue({}, { maxDepth: HARD_MAX_DEPTH + 1 }),
    ).toThrowError(ProbeOptionsError);
    expect(() =>
      serializeProbeValue("", {
        maxStringLength: HARD_MAX_STRING_LENGTH + 1,
      }),
    ).toThrowError(ProbeOptionsError);
  });

  it("keeps the shared hard node budget when soft budgets are bypassed", () => {
    const dense = Array.from({ length: 20 }, () =>
      Array.from({ length: 200 }, () => 1),
    );
    const context = createSerializationContext({ bypassBudgets: true });

    serializeProbeValue(dense, { path: ["setup", "first"] }, context);
    const second = serializeProbeValue(
      dense,
      { path: ["data", "second"] },
      context,
    );

    expect(context.nodesUsed).toBe(HARD_MAX_NODES);
    expect(JSON.stringify(second)).toContain('"$type":"truncated"');
  });

  it("shares a one-million-character string budget across serialization calls", () => {
    const context = createSerializationContext({
      maxDepth: 20,
      maxEntries: 200,
      maxStringLength: HARD_MAX_STRING_LENGTH,
    });
    const chunk = "x".repeat(HARD_MAX_STRING_LENGTH);
    const values = Array.from({ length: 11 }, (_, index) =>
      serializeProbeValue(chunk, { path: [index] }, context),
    );

    expect(HARD_MAX_TOTAL_STRING_LENGTH).toBe(1_000_000);
    expect(context.stringCharactersUsed).toBe(HARD_MAX_TOTAL_STRING_LENGTH);
    expect(values.slice(0, 10)).toEqual(Array(10).fill(chunk));
    expect(values[10]).toEqual({
      $type: "truncated",
      kind: "string",
      path: [10],
      total: HARD_MAX_STRING_LENGTH,
      returned: 0,
      preview: "",
      nextOffset: 0,
      reason: "string-budget",
    });
  });

  it("counts strings across an entire serialized record, not per property", () => {
    const value = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [
        `value${index}`,
        String(index).repeat(HARD_MAX_STRING_LENGTH),
      ]),
    );
    const context = createSerializationContext({
      maxDepth: 2,
      maxEntries: 200,
      maxStringLength: HARD_MAX_STRING_LENGTH,
    });
    const result = serializeProbeValue(value, {}, context);

    expect(context.stringCharactersUsed).toBeLessThanOrEqual(
      HARD_MAX_TOTAL_STRING_LENGTH,
    );
    expect(JSON.stringify(result)).toContain('"reason":"string-budget"');
  });

  it("charges generated function and error strings to the shared budget", () => {
    const context = createSerializationContext({ maxStringLength: 100 });
    context.stringCharactersUsed = HARD_MAX_TOTAL_STRING_LENGTH - 1;

    expect(serializeProbeValue(function generatedName() {}, {}, context)).toMatchObject({
      $type: "truncated",
      reason: "string-budget",
      returned: 1,
    });
    expect(serializeProbeValue(new Error("generated message"), {}, context)).toMatchObject({
      $type: "truncated",
      reason: "string-budget",
      returned: 0,
    });
    expect(context.stringCharactersUsed).toBe(HARD_MAX_TOTAL_STRING_LENGTH);
  });

  it("bounds the aggregate strings and keys in the final delivered payload", () => {
    const budget = createProbePayloadBudget();
    budget.remainingStringCharacters = 3;

    expect(boundProbePayload({ longKey: "value" }, ["state"], budget)).toEqual({
      terminal: true,
      value: {
        $type: "truncated",
        kind: "object",
        path: ["state"],
        total: 0,
        returned: 0,
        preview: null,
        nextOffset: null,
        reason: "string-budget",
      },
    });
    expect(budget.terminalEmitted).toBe(true);
  });

  it("reserves capacity for exactly one terminal payload marker", () => {
    const budget = createProbePayloadBudget();
    const first = Array.from({ length: HARD_MAX_NODES - 3 }, () => 1);
    expect(boundProbePayload(first, ["first"], budget)).toEqual({
      value: first,
      terminal: false,
    });
    expect(boundProbePayload(1, ["second"], budget)).toEqual({
      terminal: true,
      value: {
        $type: "truncated",
        kind: "object",
        path: ["second"],
        total: 0,
        returned: 0,
        preview: null,
        nextOffset: null,
        reason: "node-budget",
      },
    });
    expect(boundProbePayload(2, ["third"], budget)).toEqual({
      value: undefined,
      terminal: true,
    });
    expect(budget.remainingNodes).toBe(0);
  });

  it("counts ordinary records with user-defined $type keys", () => {
    const value = {
      $type: "user-value",
      dense: Array.from({ length: HARD_MAX_NODES }, () => 1),
    };
    expect(() =>
      boundProbePayload(value, ["state"], createProbePayloadBudget()),
    ).not.toThrow();
    expect(
      boundProbePayload(value, ["state"], createProbePayloadBudget()),
    ).toMatchObject({
      terminal: true,
      value: {
        $type: "truncated",
        reason: "node-budget",
        path: ["state"],
      },
    });
  });

  it("counts malformed exact special tags conservatively without throwing", () => {
    const collisions = [
      {
        $type: "map",
        size: 1,
        entries: [1],
        returned: 1,
        nextOffset: null,
      },
      {
        $type: "set",
        size: 1,
        values: "not-an-array",
        returned: 1,
        nextOffset: null,
      },
      {
        $type: "truncated",
        kind: "invalid",
        path: {},
        total: -1,
        returned: -1,
        preview: { value: 1 },
        nextOffset: -1,
      },
    ] as unknown as Array<Parameters<typeof boundProbePayload>[0]>;

    for (const collision of collisions) {
      expect(() =>
        boundProbePayload(collision, ["state"], createProbePayloadBudget()),
      ).not.toThrow();
    }
  });

  it("clamps BigInt decimals and Element rendering", () => {
    expect(serializeProbeValue(123456789n, { maxStringLength: 4 })).toEqual({
      $type: "bigint",
      value: "1234",
      truncated: true,
      totalDigits: 9,
    });
    expect(serializeProbeValue(-123456n, { maxStringLength: 4 })).toEqual({
      $type: "bigint",
      value: "-123",
      truncated: true,
      totalDigits: 6,
    });

    const previousElement = globalThis.Element;
    class FakeElement {
      tagName = "VERY-LONG-CUSTOM-ELEMENT";
    }
    Object.defineProperty(globalThis, "Element", {
      configurable: true,
      value: FakeElement,
    });
    try {
      expect(
        serializeProbeValue(new FakeElement(), { maxStringLength: 12 }),
      ).toBe("[HTMLElement");
    } finally {
      Object.defineProperty(globalThis, "Element", {
        configurable: true,
        value: previousElement,
      });
    }
  });

  it("never copies oversized runtime object keys into ProbeValue payloads", () => {
    const hugeKey = "k".repeat(HARD_MAX_PATH_SEGMENT_LENGTH + 1);
    const result = serializeProbeValue({ [hugeKey]: 1 });
    expect(result).toMatchObject({
      $type: "truncated",
      reason: "key-length",
      preview: null,
    });
    expect(JSON.stringify(result)).not.toContain(hugeKey);
  });

  it("keeps store references atomic or truncates the whole marker", () => {
    const reference = {
      $type: "store-reference" as const,
      storeId: "users",
      appId: "app",
    };
    expect(serializeProbeValue(reference)).toEqual(reference);
    expect(serializeProbeValue(reference, { maxStringLength: 1 })).toMatchObject({
      $type: "truncated",
      kind: "object",
      preview: null,
    });
  });

  it("slices hostile function names before interpolation", () => {
    let reads = 0;
    const hugeName = "n".repeat(200_000);
    const callable = new Proxy(function value() {}, {
      get(target, property, receiver) {
        if (property === "name") {
          reads += 1;
          return hugeName;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(serializeProbeValue(callable, { maxStringLength: 12 })).toBe(
      "[Function nn",
    );
    expect(reads).toBe(1);
  });

  it("does not mistake a shared reference for a circular reference", () => {
    const shared = { value: 1 };
    expect(serializeProbeValue({ left: shared, right: shared })).toEqual({
      left: { value: 1 },
      right: { value: 1 },
    });
  });

  it("reads only maxEntries plus one Map and Set iterator items", () => {
    let mapNextCalls = 0;
    let setNextCalls = 0;
    const map = new Map(
      Array.from({ length: 1000 }, (_, index) => [index, index]),
    );
    const set = new Set(Array.from({ length: 1000 }, (_, index) => index));
    const originalMapEntries = map.entries.bind(map);
    const originalSetValues = set.values.bind(set);
    map.entries = () => {
      const iterator = originalMapEntries();
      const next = iterator.next.bind(iterator);
      iterator.next = () => {
        mapNextCalls += 1;
        return next();
      };
      return iterator;
    };
    set.values = () => {
      const iterator = originalSetValues();
      const next = iterator.next.bind(iterator);
      iterator.next = () => {
        setNextCalls += 1;
        return next();
      };
      return iterator;
    };

    expect(serializeProbeValue(map, { maxEntries: 2 })).toMatchObject({
      $type: "map",
      size: 1000,
      returned: 2,
      nextOffset: 2,
    });
    expect(serializeProbeValue(set, { maxEntries: 2 })).toMatchObject({
      $type: "set",
      size: 1000,
      returned: 2,
      nextOffset: 2,
    });
    expect(mapNextCalls).toBe(3);
    expect(setNextCalls).toBe(3);
  });

  it("derives Map continuation from iterator lookahead instead of size", () => {
    let exactNextCalls = 0;
    const exact = new Map([["a", 1], ["b", 2]]);
    const exactEntries = exact.entries.bind(exact);
    exact.entries = () => {
      const iterator = exactEntries();
      const next = iterator.next.bind(iterator);
      iterator.next = () => {
        exactNextCalls += 1;
        return next();
      };
      return iterator;
    };
    expect(serializeProbeValue(exact, { maxEntries: 2 })).toMatchObject({
      returned: 2,
      nextOffset: null,
    });
    expect(exactNextCalls).toBe(3);

    const mutating = new Map([["a", 1], ["b", 2]]);
    const mutatingEntries = mutating.entries.bind(mutating);
    mutating.entries = () => {
      const iterator = mutatingEntries();
      const next = iterator.next.bind(iterator);
      let calls = 0;
      iterator.next = () => {
        const item = next();
        calls += 1;
        if (calls === 1) mutating.delete("b");
        return item;
      };
      return iterator;
    };
    expect(serializeProbeValue(mutating, { maxEntries: 1 })).toMatchObject({
      size: 2,
      returned: 1,
      nextOffset: null,
    });
  });

  it("safely clamps hostile Error, symbol, and function-generated strings", () => {
    const hostileError = new Error("hidden");
    Object.defineProperties(hostileError, {
      name: {
        get() {
          throw new Error("name trap");
        },
      },
      message: {
        get() {
          throw new Error("message trap");
        },
      },
    });
    const hostileFunction = new Proxy(function callable() {}, {
      get(target, property, receiver) {
        if (property === "name") throw new Error("name trap");
        return Reflect.get(target, property, receiver);
      },
    });
    const value = serializeProbeValue(
      [hostileError, Symbol("very-long-symbol"), hostileFunction],
      { maxStringLength: 10 },
    );
    expect(() => JSON.stringify(value)).not.toThrow();
    expect(value).toEqual([
      { $type: "error", name: "Error", message: "Unknown er" },
      "Symbol(ver",
      "[Function]",
    ]);
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
