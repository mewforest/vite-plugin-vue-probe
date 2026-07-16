import { describe, expect, it, vi } from "vitest";
import { createProbeAPI } from "../src/core/facade";
import type { ProbeAPI } from "../src/public-types";
import type { ProbeDataSource } from "../src/data-source/types";

function sourceFixture(): ProbeDataSource {
  return {
    init() {},
    hasApp: vi.fn(() => true),
    hasPiniaInspector: vi.fn(async () => true),
    listApps: vi.fn(() => [
      { id: "app", name: "Demo", vueVersion: "3.5.0", active: true },
    ]),
    getActiveAppId: vi.fn(() => "app"),
    getRevision: vi.fn(() => 4),
    getComponentTree: vi.fn(async () => ({
      appId: "app",
      rootId: "root",
      nodes: [],
    })),
    getComponentState: vi.fn(async () => ({
      appId: "app",
      componentId: "component",
      name: "Component",
      state: {},
    })),
    getPiniaStores: vi.fn(async () => []),
    getPiniaState: vi.fn(async () => ({
      appId: "app",
      storeId: "store",
      state: {},
    })),
    getComponentRoots: vi.fn(() => []),
  };
}

type RuntimeProbeAPI = {
  [K in keyof ProbeAPI]: ProbeAPI[K] extends (...args: never[]) => unknown
    ? (...args: unknown[]) => unknown
    : ProbeAPI[K];
};

async function expectInvalid(invoke: () => unknown): Promise<void> {
  let returned: unknown;
  expect(() => {
    returned = invoke();
  }).not.toThrow();
  await expect(returned).resolves.toMatchObject({
    ok: false,
    error: { code: "INVALID_OPTIONS" },
  });
}

describe("Probe API runtime validation", () => {
  it.each([
    ["tree null options", (api: RuntimeProbeAPI) => api.getComponentTree(null)],
    [
      "tree format",
      (api: RuntimeProbeAPI) => api.getComponentTree({ format: "wide" }),
    ],
    [
      "tree filter",
      (api: RuntimeProbeAPI) => api.getComponentTree({ filter: 1 }),
    ],
    [
      "tree includeFile",
      (api: RuntimeProbeAPI) => api.getComponentTree({ includeFile: "yes" }),
    ],
    [
      "tree root id",
      (api: RuntimeProbeAPI) => api.getComponentTree({ rootId: "   " }),
    ],
    [
      "tree app id",
      (api: RuntimeProbeAPI) => api.getComponentTree({ appId: "" }),
    ],
    [
      "tree depth above advertised hard limit",
      (api: RuntimeProbeAPI) => api.getComponentTree({ maxDepth: 21 }),
    ],
    [
      "component id",
      (api: RuntimeProbeAPI) => api.getComponentState("", {}),
    ],
    [
      "component id above hard limit",
      (api: RuntimeProbeAPI) =>
        api.getComponentState("x".repeat(1_001), {}),
    ],
    [
      "component metadata flag",
      (api: RuntimeProbeAPI) =>
        api.getComponentState("component", { includeMetadata: 1 }),
    ],
    [
      "component null options",
      (api: RuntimeProbeAPI) => api.getComponentState("component", null),
    ],
    [
      "component expected revision",
      (api: RuntimeProbeAPI) =>
        api.getComponentState("component", { expectedRevision: -1 }),
    ],
    [
      "detailed target",
      (api: RuntimeProbeAPI) => api.getDetailedState(null, [], {}),
    ],
    [
      "detailed target kind",
      (api: RuntimeProbeAPI) =>
        api.getDetailedState({ kind: "vuex", storeId: "store" }, [], {}),
    ],
    [
      "detailed target id",
      (api: RuntimeProbeAPI) =>
        api.getDetailedState({ kind: "pinia", storeId: " " }, [], {}),
    ],
    [
      "detailed null options",
      (api: RuntimeProbeAPI) =>
        api.getDetailedState(
          { kind: "component", componentId: "component" },
          [],
          null,
        ),
    ],
    [
      "Pinia options",
      (api: RuntimeProbeAPI) => api.getPiniaStores(null),
    ],
    [
      "Pinia filter",
      (api: RuntimeProbeAPI) => api.getPiniaStores({ filter: false }),
    ],
    [
      "Pinia includeKeys",
      (api: RuntimeProbeAPI) => api.getPiniaStores({ includeKeys: "yes" }),
    ],
    ["store id", (api: RuntimeProbeAPI) => api.getPiniaState(" ", {})],
    [
      "store null options",
      (api: RuntimeProbeAPI) => api.getPiniaState("store", null),
    ],
    [
      "DOM component id",
      (api: RuntimeProbeAPI) => api.getComponentDOM("", {}),
    ],
    [
      "DOM expected revision",
      (api: RuntimeProbeAPI) =>
        api.getComponentDOM("component", { expectedRevision: 1.5 }),
    ],
    [
      "DOM null options",
      (api: RuntimeProbeAPI) => api.getComponentDOM("component", null),
    ],
  ])("rejects %s before reading the data source", async (_name, invoke) => {
    const source = sourceFixture();
    const api = createProbeAPI(source) as RuntimeProbeAPI;

    await expectInvalid(() => invoke(api));

    expect(source.hasApp).not.toHaveBeenCalled();
    expect(source.hasPiniaInspector).not.toHaveBeenCalled();
    expect(source.listApps).not.toHaveBeenCalled();
    expect(source.getActiveAppId).not.toHaveBeenCalled();
    expect(source.getRevision).not.toHaveBeenCalled();
    expect(source.getComponentTree).not.toHaveBeenCalled();
    expect(source.getComponentState).not.toHaveBeenCalled();
    expect(source.getPiniaStores).not.toHaveBeenCalled();
    expect(source.getPiniaState).not.toHaveBeenCalled();
    expect(source.getComponentRoots).not.toHaveBeenCalled();
  });

  it("turns hostile option getters into INVALID_OPTIONS without a sync throw", async () => {
    const source = sourceFixture();
    const api = createProbeAPI(source) as RuntimeProbeAPI;
    const options = new Proxy(
      {},
      {
        ownKeys() {
          return ["appId"];
        },
        getOwnPropertyDescriptor() {
          throw new Error("descriptor trap");
        },
      },
    );

    await expectInvalid(() => api.getComponentTree(options));
    expect(source.getComponentTree).not.toHaveBeenCalled();
  });

  it("rejects accessor options before invoking their getters", async () => {
    const source = sourceFixture();
    const api = createProbeAPI(source) as RuntimeProbeAPI;
    const options = Object.defineProperty({}, "appId", {
      enumerable: true,
      get() {
        throw new Error("getter must not run");
      },
    });

    await expectInvalid(() => api.getComponentTree(options));
    expect(source.getComponentTree).not.toHaveBeenCalled();
  });

  it("maps a revoked options proxy to a stable INVALID_OPTIONS failure", async () => {
    const source = sourceFixture();
    const api = createProbeAPI(source) as RuntimeProbeAPI;
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    await expectInvalid(() => api.getComponentTree(proxy));
    expect(source.getComponentTree).not.toHaveBeenCalled();
  });

  it("accepts safe null-prototype option records", async () => {
    const options = Object.assign(Object.create(null), {
      format: "flat",
      includeFile: false,
    });
    const api = createProbeAPI(sourceFixture()) as RuntimeProbeAPI;

    await expect(api.getComponentTree(options)).resolves.toMatchObject({
      ok: true,
      data: { format: "flat" },
    });
  });
});
