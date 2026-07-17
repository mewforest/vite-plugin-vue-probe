import { describe, expect, it, vi } from "vitest";
import {
  DevtoolsDataSource,
  type DevtoolsBridge,
} from "../src/data-source/devtools";

function piniaBridge(
  stores: Record<string, Record<string, unknown>>,
): DevtoolsBridge {
  let activeAppId = "app";
  return {
    init() {},
    getApps: () => [{ id: "app", name: "App" }],
    getActiveAppId: () => activeAppId,
    toggleApp: (appId) => {
      activeAppId = appId;
    },
    hasInspector: () => true,
    getInspectorTree: vi.fn(async (inspectorId) =>
      inspectorId === "pinia"
        ? Object.keys(stores).map((id) => ({ id, label: id }))
        : [],
    ),
    getInspectorState: vi.fn(async (_inspectorId, nodeId) => stores[nodeId]),
    getComponentFromElement: () => undefined,
    getComponentRoots: () => undefined,
    onRevision: () => [],
  };
}

describe("Pinia inspector-shaped store contracts", () => {
  it("normalizes an option-store payload with state and getters", async () => {
    const bridge = piniaBridge({
      users: {
        state: [
          { key: "users", value: [{ id: 1, name: "Ada" }] },
          { key: "loading", value: false },
        ],
        getters: [{ key: "count", value: 1 }],
      },
    });
    const source = new DevtoolsDataSource(bridge);

    await expect(source.getPiniaStores("app")).resolves.toEqual([
      { appId: "app", id: "users" },
    ]);
    expect(bridge.getInspectorState).not.toHaveBeenCalled();
    await expect(source.getPiniaStores("app", "", true)).resolves.toEqual([
      {
        appId: "app",
        id: "users",
        stateKeys: ["users", "loading"],
        getterKeys: ["count"],
      },
    ]);
    await expect(source.getPiniaState("app", "users")).resolves.toEqual({
      appId: "app",
      storeId: "users",
      state: {
        users: [{ id: 1, name: "Ada" }],
        loading: false,
      },
      getters: { count: 1 },
    });
  });

  it("normalizes a setup-store payload with custom properties", async () => {
    const bridge = piniaBridge({
      session: {
        state: [
          {
            key: "token",
            value: { _custom: { type: "ref", value: "secret" } },
          },
          {
            key: "profile",
            value: { _custom: { type: "reactive", value: { name: "Lin" } } },
          },
        ],
        getters: [
          {
            key: "authenticated",
            value: { _custom: { type: "computed", value: true } },
          },
        ],
        "custom properties": [
          { key: "hydrated", value: { _custom: { value: true } } },
        ],
      },
    });
    const source = new DevtoolsDataSource(bridge);

    await expect(source.getPiniaState("app", "session")).resolves.toEqual({
      appId: "app",
      storeId: "session",
      state: { token: "secret", profile: { name: "Lin" } },
      getters: { authenticated: true },
      customProperties: { hydrated: true },
    });
  });
});
