// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createProbeAPI } from "../src/core/facade";
import { DataSourceError, type ProbeDataSource } from "../src/data-source/types";
import type { ProbeErrorCode, ProbeResult } from "../src/public-types";

function sourceFixture(
  overrides: Partial<ProbeDataSource> = {},
): ProbeDataSource {
  const cyclic: Record<string, unknown> = { label: "root" };
  cyclic.self = cyclic;
  const root = document.createElement("button");
  root.dataset.testid = "contract-action";
  root.textContent = "Save";
  document.body.append(root);

  return {
    init() {},
    hasApp: () => true,
    hasPiniaInspector: async () => true,
    listApps: () => [
      {
        id: "app",
        name: "Contract app",
        vueVersion: "3.x",
        active: true,
      },
    ],
    getActiveAppId: () => "app",
    getRevision: () => 7,
    getComponentTree: async () => ({
      appId: "app",
      rootId: "component",
      nodes: [
        {
          id: "component",
          name: "ContractComponent",
          parentId: null,
          depth: 0,
          hasChildren: false,
        },
      ],
    }),
    getComponentState: async () => ({
      appId: "app",
      componentId: "component",
      name: "ContractComponent",
      state: {
        setup: {
          undefinedValue: undefined,
          nan: Number.NaN,
          positiveInfinity: Number.POSITIVE_INFINITY,
          negativeInfinity: Number.NEGATIVE_INFINITY,
          bigint: 42n,
          date: new Date("2026-07-16T10:00:00.000Z"),
          map: new Map([["answer", 42]]),
          set: new Set(["a", "b"]),
          error: new TypeError("broken"),
          cyclic,
          longText: "x".repeat(600),
          store: {
            $type: "store-reference",
            storeId: "users",
            appId: "app",
          },
        },
      },
    }),
    getPiniaStores: async (_appId, _filter, includeKeys) => [
      {
        appId: "app",
        id: "users",
        ...(includeKeys
          ? { stateKeys: ["users"], getterKeys: ["count"] }
          : {}),
      },
    ],
    getPiniaState: async () => ({
      appId: "app",
      storeId: "users",
      state: { users: [1, 2] },
      getters: { count: 2 },
    }),
    getComponentFromElement: () => ({
      componentId: "component",
      name: "ContractComponent",
    }),
    getComponentRoots: () => [root],
    ...overrides,
  };
}

function expectJsonWireValue(value: unknown): void {
  const visit = (candidate: unknown): void => {
    expect(candidate).not.toBeUndefined();
    expect(typeof candidate).not.toBe("bigint");
    expect(typeof candidate).not.toBe("function");
    expect(candidate).not.toBeInstanceOf(Element);
    expect(candidate).not.toBeInstanceOf(Node);
    if (candidate === null || typeof candidate !== "object") return;
    if (Array.isArray(candidate)) {
      for (let index = 0; index < candidate.length; index += 1) {
        expect(Object.hasOwn(candidate, index)).toBe(true);
        visit(candidate[index]);
      }
      return;
    }
    expect([Object.prototype, null]).toContain(Object.getPrototypeOf(candidate));
    Object.values(candidate).forEach(visit);
  };

  visit(value);
  const json = JSON.stringify(value);
  expect(json).toBeTypeOf("string");
  const parsed: unknown = JSON.parse(json);
  visit(parsed);
  expect(parsed).toEqual(value);
}

function errorSource(
  method: keyof ProbeDataSource,
  code: ProbeErrorCode,
): ProbeDataSource {
  const source = sourceFixture();
  Object.assign(source, {
    [method]: () => {
      throw new DataSourceError(code, `${String(method)} failed`);
    },
  });
  return source;
}

describe("public JSON wire contract", () => {
  it.each([
    ["undefined", { missing: undefined }],
    ["function", { callback() {} }],
    ["DOM", { node: document.createElement("div") }],
    ["prototype", { date: new Date() }],
    ["array hole", new Array(1)],
  ])("rejects %s in the original result graph", (_name, invalid) => {
    expect(() => expectJsonWireValue(invalid)).toThrow();
  });

  it("publishes the exact API 0.2 runtime defaults and hard limits", async () => {
    const result = await createProbeAPI(sourceFixture()).getCapabilities();

    expect(result).toMatchObject({
      ok: true,
      data: {
        apiVersion: "0.4.0",
        componentFromDOM: true,
        defaults: {
          maxDepth: 2,
          maxEntries: 25,
          maxStringLength: 500,
          detailMaxDepth: 3,
          detailPageSize: 50,
          hardMaxEntries: 200,
          hardMaxDepth: 20,
          hardMaxStringLength: 100_000,
          hardMaxTotalStringLength: 1_000_000,
          hardMaxNodes: 5_000,
          hardMaxOffset: 1_000_000,
          hardMaxPathSegments: 100,
          hardMaxPathSegmentLength: 100_000,
          hardMaxPathTotalLength: 100_000,
          hardMaxIdentifierLength: 1_000,
        },
      },
    });
  });

  it("serializes success envelopes for every public method without runtime objects", async () => {
    const api = createProbeAPI(sourceFixture());
    const results: ProbeResult<unknown>[] = [
      await api.getCapabilities(),
      await api.listApps(),
      await api.getComponentTree({ appId: "app" }),
      await api.getComponentState("component", { appId: "app" }),
      await api.getDetailedState(
        { kind: "component", componentId: "component", appId: "app" },
        ["setup", "map"],
      ),
      await api.getPiniaStores({ appId: "app", includeKeys: true }),
      await api.getPiniaState("users", { appId: "app" }),
      await api.getComponentDOM("component", { appId: "app" }),
      await api.getComponentFromDOM('[data-testid="contract-action"]', {
        appId: "app",
      }),
    ];

    expect(results).toHaveLength(9);
    expect(results.every((result) => result.ok)).toBe(true);
    results.forEach(expectJsonWireValue);

    const state = results[3];
    expect(state).toMatchObject({
      ok: true,
      data: {
        state: {
          setup: {
            undefinedValue: { $type: "undefined" },
            nan: { $type: "number", value: "NaN" },
            positiveInfinity: { $type: "number", value: "Infinity" },
            negativeInfinity: { $type: "number", value: "-Infinity" },
            bigint: { $type: "bigint", value: "42" },
            date: { $type: "date", value: "2026-07-16T10:00:00.000Z" },
            map: { $type: "map", returned: 1, nextOffset: null },
            set: { $type: "set", returned: 2, nextOffset: null },
            error: { $type: "error", name: "TypeError", message: "broken" },
            cyclic: {
              self: { $type: "circular-reference", targetPath: ["setup", "cyclic"] },
            },
            longText: { $type: "truncated", kind: "string", returned: 500 },
            store: { $type: "store-reference", storeId: "users" },
          },
        },
      },
    });
  });

  it.each([200, 1_000])(
    "caps a conceptual %s00KB state response under the aggregate string budget",
    async (entries) => {
      const chunk = "x".repeat(100_000);
      const state = Object.fromEntries(
        Array.from({ length: entries }, (_, index) => [`value-${index}`, chunk]),
      );
      const api = createProbeAPI(
        sourceFixture({
          getComponentState: async () => ({
            appId: "app",
            componentId: "component",
            name: "Large",
            file: "/Large.vue",
            state: { setup: state },
          }),
        }),
      );
      const result = await api.getComponentState("component", {
        appId: "app",
        maxDepth: 20,
        maxEntries: 200,
        maxStringLength: 100_000,
        includeMetadata: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const stringCharacters = (value: unknown): number => {
        if (typeof value === "string") return value.length;
        if (value === null || typeof value !== "object") return 0;
        if (Array.isArray(value))
          return value.reduce((total, item) => total + stringCharacters(item), 0);
        return Object.entries(value).reduce(
          (total, [key, item]) => total + key.length + stringCharacters(item),
          0,
        );
      };
      expect(stringCharacters(result.data)).toBeLessThanOrEqual(1_000_000);
      expectJsonWireValue(result);
    },
  );

  it("reserves the component section key before consuming a near-limit value", async () => {
    const setup = Object.fromEntries([
      ...Array.from({ length: 9 }, (_, index) => [
        `v${index}`,
        "x".repeat(100_000),
      ]),
      ["v9", "x".repeat(99_924)],
    ]);
    const api = createProbeAPI(
      sourceFixture({
        getComponentState: async () => ({
          appId: "app",
          componentId: "component",
          name: "Large",
          file: "/Large.vue",
          state: { setup },
        }),
      }),
    );

    const result = await api.getComponentState("component", {
      appId: "app",
      maxDepth: 20,
      maxEntries: 200,
      maxStringLength: 100_000,
    });

    expect(result).toMatchObject({
      ok: true,
      data: { state: { setup: expect.anything() } },
    });
  });

  it("shares the aggregate state budget with emitted metadata strings", async () => {
    const keys = Array.from({ length: 20 }, (_, index) => `field-${index}`);
    const api = createProbeAPI(
      sourceFixture({
        getComponentState: async () => ({
          appId: "app",
          componentId: "component",
          name: "Metadata",
          state: { setup: Object.fromEntries(keys.map((key) => [key, 1])) },
          metadata: {
            setup: Object.fromEntries(
              keys.map((key) => [
                key,
                { reactivity: "plain" as const, propType: "T".repeat(100_000) },
              ]),
            ),
          },
        }),
      }),
    );
    const result = await api.getComponentState("component", {
      appId: "app",
      includeMetadata: true,
      maxEntries: 200,
      maxStringLength: 100_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const count = (value: unknown): number =>
      typeof value === "string"
        ? value.length
        : value !== null && typeof value === "object"
          ? Object.entries(value).reduce(
              (total, [key, item]) => total + key.length + count(item),
              0,
            )
          : 0;
    expect(count(result.data)).toBeLessThanOrEqual(1_000_000);
  });

  it("serializes a failure envelope for every public method", async () => {
    const capabilities = createProbeAPI(
      errorSource("hasPiniaInspector", "INTERNAL_ERROR"),
    );
    const apps = createProbeAPI(errorSource("listApps", "INTERNAL_ERROR"));
    const tree = createProbeAPI(errorSource("getComponentTree", "APP_NOT_FOUND"));
    const component = createProbeAPI(
      errorSource("getComponentState", "COMPONENT_NOT_FOUND"),
    );
    const stores = createProbeAPI(
      errorSource("getPiniaStores", "INTERNAL_ERROR"),
    );
    const pinia = createProbeAPI(
      errorSource("getPiniaState", "STORE_NOT_FOUND"),
    );
    const dom = createProbeAPI(
      errorSource("getComponentRoots", "COMPONENT_NOT_FOUND"),
    );
    const fromDOM = createProbeAPI(
      errorSource("getComponentFromElement", "COMPONENT_NOT_FOUND"),
    );
    const detail = createProbeAPI(sourceFixture());

    const results = [
      await capabilities.getCapabilities(),
      await apps.listApps(),
      await tree.getComponentTree({ appId: "missing" }),
      await component.getComponentState("missing", { appId: "app" }),
      await detail.getDetailedState(
        { kind: "component", componentId: "component", appId: "app" },
        ["setup", "missing"],
      ),
      await stores.getPiniaStores({ appId: "app" }),
      await pinia.getPiniaState("missing", { appId: "app" }),
      await dom.getComponentDOM("missing", { appId: "app" }),
      await fromDOM.getComponentFromDOM(
        '[data-testid="contract-action"]',
        { appId: "app" },
      ),
    ];

    expect(results).toHaveLength(9);
    expect(results.every((result) => !result.ok)).toBe(true);
    results.forEach(expectJsonWireValue);
  });

  it("covers every public error code with a JSON-safe envelope", async () => {
    const notReady = createProbeAPI(
      sourceFixture({ getActiveAppId: () => undefined }),
    );
    const stale = createProbeAPI(sourceFixture());
    const invalid = createProbeAPI(sourceFixture());
    const results = [
      await notReady.getComponentTree(),
      await createProbeAPI(errorSource("getComponentTree", "APP_NOT_FOUND"))
        .getComponentTree({ appId: "missing" }),
      await createProbeAPI(
        errorSource("getComponentState", "COMPONENT_NOT_FOUND"),
      ).getComponentState("missing", { appId: "app" }),
      await createProbeAPI(
        errorSource("getPiniaState", "STORE_NOT_FOUND"),
      ).getPiniaState("missing", { appId: "app" }),
      await createProbeAPI(sourceFixture()).getDetailedState(
        { kind: "component", componentId: "component", appId: "app" },
        ["setup", "missing"],
      ),
      await (invalid as unknown as {
        getComponentTree(options: unknown): ReturnType<typeof invalid.getComponentTree>;
      }).getComponentTree({ format: "wide" }),
      await stale.getComponentDOM("component", {
        appId: "app",
        expectedRevision: 6,
      }),
      await createProbeAPI(errorSource("listApps", "INTERNAL_ERROR")).listApps(),
    ];
    const codes = results.map((result) =>
      result.ok ? "SUCCESS" : result.error.code,
    );

    expect(codes).toEqual([
      "NOT_READY",
      "APP_NOT_FOUND",
      "COMPONENT_NOT_FOUND",
      "STORE_NOT_FOUND",
      "PATH_NOT_FOUND",
      "INVALID_OPTIONS",
      "STALE_REVISION",
      "INTERNAL_ERROR",
    ]);
    results.forEach(expectJsonWireValue);
  });
});
