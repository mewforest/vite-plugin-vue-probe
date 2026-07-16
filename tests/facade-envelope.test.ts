import { describe, expect, it, vi } from "vitest";
import { createProbeAPI } from "../src/core/facade";
import type { ProbeDataSource } from "../src/data-source/types";

function sourceFixture(): ProbeDataSource {
  return {
    init() {},
    hasApp: () => true,
    hasPiniaInspector: async () => false,
    listApps: () => [],
    getActiveAppId: () => "app",
    getRevision: () => 4,
    getComponentTree: vi.fn(),
    getComponentState: async () => ({
      appId: "app",
      componentId: "component",
      name: "Component",
      state: {},
    }),
    getPiniaStores: vi.fn(),
    getPiniaState: vi.fn(),
    getComponentRoots: vi.fn(() => []),
  } as unknown as ProbeDataSource;
}

describe("ProbeResult envelope", () => {
  it("turns a successful list read into INTERNAL_ERROR when active-app metadata fails", async () => {
    const source = sourceFixture();
    const listApps = vi.fn(() => []);
    source.listApps = listApps;
    source.getActiveAppId = () => {
      throw new Error("active metadata failed");
    };
    const api = createProbeAPI(source);

    await expect(api.listApps()).resolves.toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "active metadata failed" },
      meta: { revision: 0 },
    });
    expect(listApps).toHaveBeenCalledOnce();
  });

  it("turns a successful app read into INTERNAL_ERROR when revision metadata fails", async () => {
    const source = sourceFixture();
    const getComponentTree = vi.fn(async () => ({
      appId: "app",
      rootId: "root",
      nodes: [],
    }));
    source.getComponentTree = getComponentTree;
    source.getRevision = () => {
      throw new Error("revision metadata failed");
    };
    const api = createProbeAPI(source);

    await expect(
      api.getComponentTree({ appId: "app" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "revision metadata failed" },
      meta: { revision: 0 },
    });
    expect(getComponentTree).toHaveBeenCalledOnce();
  });

  it("does not mistake a thrown undefined metadata value for success", async () => {
    const source = sourceFixture();
    source.getActiveAppId = () => {
      throw undefined;
    };
    const api = createProbeAPI(source);

    await expect(api.listApps()).resolves.toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Internal error" },
      meta: { revision: 0 },
    });
  });

  it("classifies a hostile thrown proxy as INTERNAL_ERROR", async () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("prototype trap");
        },
        get() {
          throw new Error("property trap");
        },
      },
    );
    const source = sourceFixture();
    source.listApps = () => {
      throw hostile;
    };
    const api = createProbeAPI(source);

    await expect(api.listApps()).resolves.toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Internal error" },
      meta: { revision: 4 },
    });
  });

  it("resolves a failure when operation and metadata sources both throw", async () => {
    const source = sourceFixture();
    source.getActiveAppId = () => {
      throw new Error("active app unavailable");
    };
    source.getRevision = () => {
      throw new Error("revision unavailable");
    };
    source.listApps = () => {
      throw new Error("operation failed");
    };
    const api = createProbeAPI(source);

    await expect(api.listApps()).resolves.toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "operation failed" },
      meta: { revision: 0 },
    });
  });

  it("retains the accepted revision when a snapshot and later revision read fail", async () => {
    const source = sourceFixture();
    let revisionReads = 0;
    source.getRevision = () => {
      revisionReads += 1;
      if (revisionReads === 1) return 4;
      throw new Error("revision unavailable");
    };
    source.getComponentState = async () => {
      throw new Error("component read failed");
    };
    const api = createProbeAPI(source);

    await expect(api.getComponentState("component")).resolves.toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "component read failed" },
      meta: { revision: 4 },
    });
    expect(revisionReads).toBe(1);
  });
});
