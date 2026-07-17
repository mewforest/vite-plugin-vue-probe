import { describe, expect, it } from "vitest";
import { createProbeAPI } from "../src/core/facade";
import type { ProbeDataSource } from "../src/data-source/types";

function revisionSource(
  read: (incrementRevision: () => void) => Promise<unknown>,
): ProbeDataSource {
  let revision = 4;
  const incrementRevision = () => {
    revision += 1;
  };
  return {
    init() {},
    hasApp: () => true,
    hasPiniaInspector: async () => true,
    listApps: () => [
      { id: "app", name: "Demo", vueVersion: "3.5.0", active: true },
    ],
    getActiveAppId: () => "app",
    getRevision: () => revision,
    getComponentTree: async () => ({
      appId: "app",
      rootId: "app:root",
      nodes: [],
    }),
    getComponentState: async () => {
      await read(incrementRevision);
      return {
        appId: "app",
        componentId: "app:1",
        name: "Example",
        state: { setup: { count: 1 } },
      };
    },
    getPiniaStores: async () => [],
    getPiniaState: async () => {
      await read(incrementRevision);
      return { appId: "app", storeId: "users", state: { count: 1 } };
    },
    getComponentFromElement: () => ({
      componentId: "component",
      name: "Component",
    }),
    getComponentRoots: () => [],
  };
}

describe("facade revision snapshots", () => {
  it("rejects a revision-zero snapshot when its app is removed during the read", async () => {
    let present = true;
    let finishRead!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    let releaseRead!: () => void;
    const delayedRead = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const source = revisionSource(async () => undefined);
    source.hasApp = () => present;
    source.getRevision = () => 0;
    source.getComponentState = async () => {
      finishRead();
      await delayedRead;
      return {
        appId: "app",
        componentId: "app:1",
        name: "Example",
        state: { setup: { count: 1 } },
      };
    };
    const api = createProbeAPI(source);

    const result = api.getComponentState("app:1");
    await readStarted;
    present = false;
    releaseRead();

    await expect(result).resolves.toMatchObject({
      ok: false,
      error: { code: "APP_NOT_FOUND" },
    });
  });

  it("detects Pinia capability from inspector presence even with zero stores", async () => {
    const source = revisionSource(async () => undefined);
    source.getPiniaStores = async () => [];
    const api = createProbeAPI(source);

    await expect(api.getCapabilities()).resolves.toMatchObject({
      ok: true,
      data: { piniaDetected: true, piniaState: true },
    });
  });

  it("forwards the public includeKeys Pinia listing option", async () => {
    const source = revisionSource(async () => undefined);
    let received: [string, string | undefined, boolean | undefined] | undefined;
    source.getPiniaStores = async (appId, filter, includeKeys) => {
      received = [appId, filter, includeKeys];
      return [];
    };
    const api = createProbeAPI(source);

    await expect(
      api.getPiniaStores({ filter: "users", includeKeys: true }),
    ).resolves.toMatchObject({ ok: true, data: [] });
    expect(received).toEqual(["app", "users", true]);
  });

  it.each([
    ["component state", (api: ReturnType<typeof createProbeAPI>) => api.getComponentState("app:1")],
    ["detailed state", (api: ReturnType<typeof createProbeAPI>) => api.getDetailedState(
      { kind: "component", componentId: "app:1" },
      ["setup", "count"],
    )],
    ["Pinia state", (api: ReturnType<typeof createProbeAPI>) => api.getPiniaState("users")],
  ])("rejects %s when revision changes during the read", async (_name, invoke) => {
    const api = createProbeAPI(
      revisionSource(async (incrementRevision) => incrementRevision()),
    );

    await expect(invoke(api)).resolves.toMatchObject({
      ok: false,
      error: { code: "STALE_REVISION" },
      meta: { revision: 5 },
    });
  });

  it.each([
    [
      "component serialization",
      (source: ProbeDataSource, incrementRevision: () => void) => {
        source.getComponentState = async () => {
          const setup: Record<string, unknown> = {};
          Object.defineProperty(setup, "count", {
            enumerable: true,
            get() {
              incrementRevision();
              return 1;
            },
          });
          return {
            appId: "app",
            componentId: "app:1",
            name: "Example",
            state: { setup },
          };
        };
      },
      (api: ReturnType<typeof createProbeAPI>) => api.getComponentState("app:1"),
    ],
    [
      "detailed-state resolution",
      (source: ProbeDataSource, incrementRevision: () => void) => {
        source.getComponentState = async () => {
          const setup: Record<string, unknown> = {};
          Object.defineProperty(setup, "count", {
            enumerable: true,
            get() {
              incrementRevision();
              return 1;
            },
          });
          return {
            appId: "app",
            componentId: "app:1",
            name: "Example",
            state: { setup },
          };
        };
      },
      (api: ReturnType<typeof createProbeAPI>) =>
        api.getDetailedState(
          { kind: "component", componentId: "app:1" },
          ["setup", "count"],
        ),
    ],
    [
      "Pinia serialization",
      (source: ProbeDataSource, incrementRevision: () => void) => {
        source.getPiniaState = async () => {
          const state: Record<string, unknown> = {};
          Object.defineProperty(state, "count", {
            enumerable: true,
            get() {
              incrementRevision();
              return 1;
            },
          });
          return { appId: "app", storeId: "users", state };
        };
      },
      (api: ReturnType<typeof createProbeAPI>) => api.getPiniaState("users"),
    ],
  ])(
    "rejects a revision emitted during %s",
    async (_name, configure, invoke) => {
      let revision = 4;
      const source = revisionSource(async () => undefined);
      source.getRevision = () => revision;
      configure(source, () => {
        revision += 1;
      });
      const api = createProbeAPI(source);

      await expect(invoke(api)).resolves.toMatchObject({
        ok: false,
        error: { code: "STALE_REVISION" },
        meta: { revision: 5 },
      });
    },
  );

  it("uses the accepted revision for success metadata", async () => {
    let revision = 4;
    const source = revisionSource(async () => undefined);
    source.getRevision = () => revision;
    source.getComponentState = async () => {
      const setup: Record<string, unknown> = {};
      Object.defineProperty(setup, "count", {
        enumerable: true,
        get() {
          queueMicrotask(() => {
            revision += 1;
          });
          return 1;
        },
      });
      return {
        appId: "app",
        componentId: "app:1",
        name: "Example",
        state: { setup },
      };
    };
    const api = createProbeAPI(source);

    await expect(api.getComponentState("app:1")).resolves.toMatchObject({
      ok: true,
      meta: { revision: 4 },
    });
    expect(revision).toBe(5);
  });
});
