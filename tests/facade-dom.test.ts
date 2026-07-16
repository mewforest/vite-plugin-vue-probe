// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createProbeAPI } from "../src/core/facade";
import type { ProbeDataSource } from "../src/data-source/types";

function sourceFixture(): ProbeDataSource {
  return {
    init() {},
    hasApp: (appId: string) => appId === "app-a" || appId === "app-b",
    hasPiniaInspector: async () => false,
    listApps: () => [
      { id: "app-a", name: "A", vueVersion: "3.5.0", active: true },
      { id: "app-b", name: "B", vueVersion: "3.5.0", active: false },
    ],
    getActiveAppId: () => "app-a",
    getRevision: () => 7,
    getComponentTree: vi.fn(),
    getComponentState: vi.fn(),
    getPiniaStores: vi.fn(),
    getPiniaState: vi.fn(),
    getComponentRoots: vi.fn(() => []),
  } as unknown as ProbeDataSource;
}

describe("component DOM snapshots", () => {
  it("reads the selected app and returns the accepted revision", async () => {
    const source = sourceFixture();
    const appBRoot = document.createElement("button");
    appBRoot.dataset.testid = "app-b-action";
    document.body.append(appBRoot);
    source.getComponentRoots = vi.fn((appId) =>
      appId === "app-b" ? [appBRoot] : [],
    );
    const api = createProbeAPI(source);

    await expect(
      api.getComponentDOM("component", {
        appId: "app-b",
        expectedRevision: 7,
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        appId: "app-b",
        componentId: "component",
        roots: [{ selector: '[data-testid="app-b-action"]' }],
      },
      meta: { revision: 7 },
    });
    expect(source.getComponentRoots).toHaveBeenCalledWith("app-b", "component");
  });

  it("rejects a revision change during locator construction", async () => {
    let revision = 7;
    const element = document.createElement("div");
    document.body.append(element);
    element.getBoundingClientRect = () => {
      revision += 1;
      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        toJSON() {},
      };
    };
    const source = sourceFixture();
    source.getRevision = () => revision;
    source.getComponentRoots = vi.fn(() => [element]);
    const api = createProbeAPI(source);

    await expect(
      api.getComponentDOM("component", { expectedRevision: 7 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STALE_REVISION" },
      meta: { revision: 8 },
    });
  });
});
