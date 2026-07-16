import { describe, expect, it, vi } from "vitest";
import {
  DevtoolsDataSource,
  type DevtoolsBridge,
} from "../src/data-source/devtools";

function bridgeFixture() {
  let active = "a";
  let revision: ((appId?: string) => void) | undefined;
  const bridge: DevtoolsBridge = {
    init: vi.fn(),
    getApps: () => [
      { id: "a", name: "App A", version: "3.5.0" },
      { id: "b", name: "App B" },
    ],
    getActiveAppId: () => active,
    toggleApp: vi.fn((id) => {
      active = id;
    }),
    getInspectorTree: vi.fn(async (inspector) =>
      inspector === "components"
        ? [
            {
              id: `${active}:root`,
              name: "Root",
              children: [{ id: `${active}:1`, name: "Child" }],
            },
          ]
        : [{ id: "users", label: "users" }],
    ),
    getInspectorState: vi.fn(async (inspector, nodeId) =>
      inspector === "components"
        ? {
            id: nodeId,
            name: "Child",
            state: [{ type: "setup", key: "count", value: 1 }],
          }
        : {
            state: [{ key: "users", value: [] }],
            getters: [{ key: "count", value: 0 }],
          },
    ),
    getComponentRoots: vi.fn(() => []),
    onRevision: (callback) => {
      revision = callback;
    },
  };
  return { bridge, emitRevision: (appId?: string) => revision?.(appId) };
}

describe("DevtoolsDataSource", () => {
  it("initializes, switches apps, and reads built-in inspectors", async () => {
    const fixture = bridgeFixture();
    const source = new DevtoolsDataSource(fixture.bridge);
    source.init();
    expect(fixture.bridge.init).toHaveBeenCalledOnce();
    expect((await source.getComponentTree("b")).nodes[0]?.id).toBe("b:root");
    expect(fixture.bridge.toggleApp).toHaveBeenCalledWith("b");
    expect((await source.getComponentState("b", "b:1")).state.setup).toEqual({
      count: 1,
    });
    expect((await source.getPiniaStores("b"))[0]?.id).toBe("users");
    expect((await source.getPiniaState("b", "users")).getters).toEqual({
      count: 0,
    });
  });

  it("maintains a revision per app and reports missing apps", async () => {
    const fixture = bridgeFixture();
    const source = new DevtoolsDataSource(fixture.bridge);
    source.init();
    fixture.emitRevision("a");
    fixture.emitRevision("a");
    expect(source.getRevision("a")).toBe(2);
    await expect(source.getComponentTree("missing")).rejects.toMatchObject({
      code: "APP_NOT_FOUND",
    });
  });
});
