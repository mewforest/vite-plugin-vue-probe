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
    getComponentFromElement: vi.fn(() => ({
      componentId: "app-a:1",
      name: "UserCard",
    })),
    getComponentRoots: vi.fn(() => []),
  } as unknown as ProbeDataSource;
}

describe("component DOM snapshots", () => {
  it.each([
    ["selector", () => "#user-card"],
    ["Element", () => document.querySelector("#user-card")!],
  ])("resolves a component from a %s", async (_label, target) => {
    const element = document.createElement("article");
    element.id = "user-card";
    document.body.replaceChildren(element);
    const source = sourceFixture();
    const api = createProbeAPI(source);

    await expect(
      api.getComponentFromDOM(target(), {
        appId: "app-a",
        expectedRevision: 7,
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        appId: "app-a",
        componentId: "app-a:1",
        name: "UserCard",
      },
      meta: { revision: 7 },
    });
    expect(source.getComponentFromElement).toHaveBeenCalledWith(
      "app-a",
      element,
    );
  });

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

  it.each([
    ["malformed selector", "[", "INVALID_OPTIONS"],
    ["missing selector", "#missing", "COMPONENT_NOT_FOUND"],
  ])("reports %s", async (_label, selector, code) => {
    document.body.replaceChildren();
    const source = sourceFixture();
    const api = createProbeAPI(source);

    await expect(api.getComponentFromDOM(selector)).resolves.toMatchObject({
      ok: false,
      error: { code },
    });
    expect(source.getComponentFromElement).not.toHaveBeenCalled();
  });

  it("rejects a revision change during reverse lookup", async () => {
    let revision = 7;
    const source = sourceFixture();
    source.getRevision = () => revision;
    source.getComponentFromElement = vi.fn(() => {
      revision += 1;
      return { componentId: "app-a:1", name: "UserCard" };
    });
    const element = document.createElement("div");
    const api = createProbeAPI(source);

    await expect(
      api.getComponentFromDOM(element, { expectedRevision: 7 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STALE_REVISION" },
      meta: { revision: 8 },
    });
  });
});
