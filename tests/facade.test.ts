import { describe, expect, it, vi } from "vitest";
import { createProbeAPI } from "../src/core/facade";
import {
  HARD_MAX_NODES,
  HARD_MAX_OFFSET,
  HARD_MAX_PATH_SEGMENT_LENGTH,
  HARD_MAX_PATH_SEGMENTS,
} from "../src/core/contract";
import type { ProbeDataSource } from "../src/data-source/types";
import type {
  MapProbeValue,
  ProbeValue,
  SetProbeValue,
  TruncatedProbeValue,
} from "../src/public-types";

function logicalProbeNodes(value: ProbeValue): number {
  if (value === null || typeof value !== "object") return 1;
  if (Array.isArray(value))
    return (
      1 +
      value.reduce<number>(
        (total, item) => total + logicalProbeNodes(item),
        0,
      )
    );
  const special = value as { $type?: string };
  if (typeof special.$type === "string") {
    if (special.$type === "map") {
      const map = value as MapProbeValue;
      return (
        1 +
        map.entries.reduce<number>(
          (total, [key, item]) =>
            total + logicalProbeNodes(key) + logicalProbeNodes(item),
          0,
        )
      );
    }
    if (special.$type === "set") {
      const set = value as SetProbeValue;
      return (
        1 +
        set.values.reduce<number>(
          (total, item) => total + logicalProbeNodes(item),
          0,
        )
      );
    }
    if (special.$type === "truncated")
      return 1 + logicalProbeNodes((value as TruncatedProbeValue).preview);
    return 1;
  }
  return (
    1 +
    Object.values(value).reduce<number>(
      (total, item) => total + logicalProbeNodes(item),
      0,
    )
  );
}

function nodeBudgetMarkers(value: ProbeValue): number {
  if (value === null || typeof value !== "object") return 0;
  if (Array.isArray(value))
    return value.reduce<number>(
      (total, item) => total + nodeBudgetMarkers(item),
      0,
    );
  const special = value as { $type?: string };
  if (typeof special.$type === "string") {
    if (special.$type === "truncated") {
      const truncated = value as TruncatedProbeValue;
      return (
        (truncated.reason === "node-budget" ? 1 : 0) +
        nodeBudgetMarkers(truncated.preview)
      );
    }
    if (special.$type === "map")
      return (value as MapProbeValue).entries.reduce<number>(
        (total, [key, item]) =>
          total + nodeBudgetMarkers(key) + nodeBudgetMarkers(item),
        0,
      );
    if (special.$type === "set")
      return (value as SetProbeValue).values.reduce<number>(
        (total, item) => total + nodeBudgetMarkers(item),
        0,
      );
    return 0;
  }
  return Object.values(value).reduce<number>(
    (total, item) => total + nodeBudgetMarkers(item),
    0,
  );
}

function sourceFixture(
  overrides: Partial<ProbeDataSource> = {},
): ProbeDataSource {
  return {
    init() {},
    hasApp: () => true,
    hasPiniaInspector: async () => true,
    listApps: () => [
      { id: "app", name: "Demo", vueVersion: "3.5.0", active: true },
    ],
    getActiveAppId: () => "app",
    getRevision: () => 4,
    getComponentTree: async () => ({
      appId: "app",
      rootId: "app:root",
      nodes: [
        {
          id: "app:root",
          name: "Root",
          parentId: null,
          depth: 0,
          hasChildren: true,
          file: "/Root.vue",
          children: [
            {
              id: "app:1",
              name: "Child",
              parentId: "app:root",
              depth: 1,
              hasChildren: false,
            },
          ],
        },
      ],
    }),
    getComponentState: async () => ({
      appId: "app",
      componentId: "app:1",
      name: "Child",
      state: {
        setup: { rows: Array.from({ length: 1000 }, (_, id) => ({ id })) },
      },
    }),
    getPiniaStores: async () => [
      {
        appId: "app",
        id: "users",
        stateKeys: ["users"],
        getterKeys: ["count"],
      },
    ],
    getPiniaState: async () => ({
      appId: "app",
      storeId: "users",
      state: { users: [1, 2, 3] },
      getters: { count: 3 },
    }),
    getComponentRoots: () => [],
    ...overrides,
  };
}

describe("Probe API facade", () => {
  it("returns capabilities, app list, and flat depth-limited trees", async () => {
    const api = createProbeAPI(sourceFixture());
    const capabilities = await api.getCapabilities();
    expect(api.version).toBe("0.2.0");
    expect(capabilities).toMatchObject({
      ok: true,
      data: {
        apiVersion: "0.2.0",
        vueDetected: true,
        piniaDetected: true,
        defaults: {
          hardMaxOffset: HARD_MAX_OFFSET,
          hardMaxPathSegments: HARD_MAX_PATH_SEGMENTS,
          hardMaxPathSegmentLength: HARD_MAX_PATH_SEGMENT_LENGTH,
        },
      },
    });
    expect(await api.listApps()).toMatchObject({
      ok: true,
      data: [{ id: "app" }],
    });
    const tree = await api.getComponentTree({ format: "flat", maxDepth: 0 });
    expect(tree).toMatchObject({
      ok: true,
      data: {
        format: "flat",
        truncatedByDepth: true,
        nodes: [{ id: "app:root" }],
      },
    });
    expect(JSON.stringify(tree)).not.toContain("/Root.vue");
  });

  it("returns immutable capability defaults without sharing caller mutations", async () => {
    const api = createProbeAPI(sourceFixture());
    const first = await api.getCapabilities();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(Object.isFrozen(first.data.defaults)).toBe(true);
    expect(() => {
      first.data.defaults.maxDepth = 999;
    }).toThrow();
    const second = await api.getCapabilities();
    expect(second).toMatchObject({
      ok: true,
      data: { defaults: { maxDepth: 2 } },
    });
  });

  it("serializes component and Pinia state and pages detailed paths", async () => {
    const api = createProbeAPI(sourceFixture());
    const state = await api.getComponentState("app:1");
    expect(state).toMatchObject({
      ok: true,
      data: { state: { setup: { rows: { $type: "truncated", total: 1000 } } } },
    });
    const detail = await api.getDetailedState(
      { kind: "component", componentId: "app:1" },
      ["setup", "rows"],
      { offset: 25, limit: 2 },
    );
    expect(detail).toMatchObject({
      ok: true,
      data: {
        target: {
          kind: "component",
          componentId: "app:1",
          appId: "app",
        },
      },
    });
    expect(detail).toMatchObject({
      ok: true,
      data: {
        page: { offset: 25, returned: 2, nextOffset: 27 },
        value: [{ id: 25 }, { id: 26 }],
      },
    });
    expect(await api.getPiniaStores()).toMatchObject({
      ok: true,
      data: [{ id: "users" }],
    });
    expect(await api.getPiniaState("users")).toMatchObject({
      ok: true,
      data: { getters: { count: 3 } },
    });
    expect(() => JSON.stringify([state, detail])).not.toThrow();
  });

  it("limits top-level state keys and reports an addressable truncation", async () => {
    const setup = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [`key-${index}`, index]),
    );
    const api = createProbeAPI(
      sourceFixture({
        getComponentState: async () => ({
          appId: "app",
          componentId: "app:1",
          name: "Child",
          state: { setup },
        }),
      }),
    );

    await expect(api.getComponentState("app:1")).resolves.toMatchObject({
      ok: true,
      data: {
        state: {
          setup: {
            $type: "truncated",
            kind: "object",
            path: ["setup"],
            total: 10_000,
            returned: 25,
            nextOffset: 25,
          },
        },
      },
    });
  });

  it("validates all state budgets before reading runtime state", async () => {
    const getComponentState = vi.fn(sourceFixture().getComponentState);
    const getPiniaState = vi.fn(sourceFixture().getPiniaState);
    const api = createProbeAPI(
      sourceFixture({ getComponentState, getPiniaState }),
    );

    await expect(
      api.getComponentState("app:1", { maxDepth: 21 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_OPTIONS" } });
    await expect(
      api.getPiniaState("users", { maxStringLength: 100_001 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_OPTIONS" } });
    await expect(
      api.getDetailedState(
        { kind: "component", componentId: "app:1" },
        [],
        { offset: HARD_MAX_OFFSET + 1 },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_OPTIONS" } });

    expect(getComponentState).not.toHaveBeenCalled();
    expect(getPiniaState).not.toHaveBeenCalled();
  });

  it("validates public StatePath before source reads", async () => {
    const getComponentState = vi.fn(sourceFixture().getComponentState);
    const api = createProbeAPI(sourceFixture({ getComponentState }));
    await expect(
      api.getDetailedState(
        { kind: "component", componentId: "app:1" },
        Array.from({ length: 101 }, () => "x"),
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_OPTIONS" } });
    await expect(
      api.getDetailedState(
        { kind: "component", componentId: "app:1" },
        ["x".repeat(100_001)],
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_OPTIONS" } });
    expect(getComponentState).not.toHaveBeenCalled();
  });

  it("caps actual ProbeValue nodes, stops later sections, and prunes metadata", async () => {
    const dense = Array.from({ length: 200 }, () =>
      Array.from({ length: 200 }, (_, index) => index),
    );
    const metadata = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [
        `orphan-${index}`,
        { readonly: true },
      ]),
    );
    metadata.kept = { readonly: true };
    const api = createProbeAPI(
      sourceFixture({
        getComponentState: async () => ({
          appId: "app",
          componentId: "app:1",
          name: "Child",
          state: {
            data: { later: dense },
            props: { kept: dense },
            setup: { later: dense },
          },
          metadata: { props: metadata },
        }),
      }),
    );
    const result = await api.getComponentState("app:1", {
      maxDepth: 20,
      maxEntries: 200,
      includeMetadata: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sections = Object.values(result.data.state);
    const nodes = sections.reduce(
      (total, section) => total + logicalProbeNodes(section),
      0,
    );
    expect(nodes).toBeLessThanOrEqual(HARD_MAX_NODES);
    expect(
      sections.reduce(
        (total, section) => total + nodeBudgetMarkers(section),
        0,
      ),
    ).toBe(1);
    expect(Object.keys(result.data.state)).toEqual(["props"]);
    expect(result.data.metadata).toBeUndefined();
  });

  it("returns metadata only for keys present in serialized state previews", async () => {
    const api = createProbeAPI(
      sourceFixture({
        getComponentState: async () => ({
          appId: "app",
          componentId: "app:1",
          name: "Child",
          state: { props: { kept: 1, dropped: 2 } },
          metadata: {
            props: {
              kept: { readonly: true },
              dropped: { readonly: true },
              orphan: { readonly: true },
            },
            setup: { orphan: { readonly: true } },
          },
        }),
      }),
    );
    const result = await api.getComponentState("app:1", {
      maxEntries: 1,
      includeMetadata: true,
    });
    expect(result).toMatchObject({
      ok: true,
      data: { metadata: { props: { kept: { readonly: true } } } },
    });
  });

  it("treats section-root store-reference shapes as records while preserving nested references", async () => {
    const storeReference = {
      $type: "store-reference" as const,
      storeId: "users",
      appId: "app",
    };
    const api = createProbeAPI(
      sourceFixture({
        getComponentState: async () => ({
          appId: "app",
          componentId: "app:1",
          name: "Child",
          state: {
            props: storeReference,
            pinia: { users: storeReference },
          },
          metadata: {
            props: {
              $type: { readonly: true },
              storeId: { readonly: true },
              appId: { readonly: true },
            },
          },
        }),
      }),
    );

    await expect(
      api.getComponentState("app:1", {
        maxEntries: 1,
        includeMetadata: true,
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: {
          props: {
            $type: "truncated",
            kind: "object",
            total: 3,
            returned: 1,
            preview: { $type: "store-reference" },
          },
          pinia: {
            users: storeReference,
          },
        },
        metadata: {
          props: {
            $type: { readonly: true },
          },
        },
      },
    });

    await expect(
      api.getComponentState("app:1", {
        maxEntries: 3,
        includeMetadata: true,
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: {
          props: storeReference,
          pinia: { users: storeReference },
        },
        metadata: {
          props: {
            $type: { readonly: true },
            storeId: { readonly: true },
            appId: { readonly: true },
          },
        },
      },
    });
  });

  it("does not mistake a user state $type key for a special section value", async () => {
    const api = createProbeAPI(
      sourceFixture({
        getComponentState: async () => ({
          appId: "app",
          componentId: "app:1",
          name: "Child",
          state: { props: { $type: "user", kept: 1, dropped: 2 } },
          metadata: {
            props: {
              $type: { readonly: true },
              kept: { readonly: true },
            },
          },
        }),
      }),
    );
    const result = await api.getComponentState("app:1", {
      maxEntries: 2,
      includeMetadata: true,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        metadata: {
          props: {
            $type: { readonly: true },
            kept: { readonly: true },
          },
        },
      },
    });
  });

  it("does not throw for malformed exact special-tag collisions through facade", async () => {
    const collision = {
      $type: "map",
      size: 1,
      entries: [1],
      returned: 1,
      nextOffset: null,
    };
    const api = createProbeAPI(
      sourceFixture({
        getComponentState: async () => ({
          appId: "app",
          componentId: "app:1",
          name: "Child",
          state: { props: collision },
        }),
      }),
    );
    await expect(api.getComponentState("app:1")).resolves.toMatchObject({
      ok: true,
      data: { state: { props: collision } },
    });
  });

  it("includes bounded and clamped metadata in the same response node budget", async () => {
    const sections = [
      "props",
      "setup",
      "data",
      "computed",
      "attrs",
      "provided",
      "injected",
      "refs",
      "pinia",
    ] as const;
    const state = Object.create(null) as Record<string, Record<string, number>>;
    const metadata = Object.create(null) as Record<
      string,
      Record<string, { propType: string; reactivity: "reactive" }>
    >;
    for (const section of sections) {
      state[section] = Object.fromEntries(
        Array.from({ length: 200 }, (_, index) => [`key-${index}`, index]),
      );
      metadata[section] = Object.fromEntries(
        Array.from({ length: 200 }, (_, index) => [
          `key-${index}`,
          {
            propType: "P".repeat(100),
            reactivity: "reactive",
          },
        ]),
      );
    }
    const api = createProbeAPI(
      sourceFixture({
        getComponentState: async () => ({
          appId: "app",
          componentId: "app:1",
          name: "Child",
          state,
          metadata,
        }),
      }),
    );
    const result = await api.getComponentState("app:1", {
      maxEntries: 200,
      maxStringLength: 10,
      includeMetadata: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stateNodes = Object.values(result.data.state).reduce(
      (total, section) => total + logicalProbeNodes(section),
      0,
    );
    let metadataNodes = result.data.metadata ? 1 : 0;
    for (const section of Object.values(result.data.metadata ?? {})) {
      metadataNodes += 1;
      for (const entry of Object.values(section)) {
        metadataNodes += 1 + Object.keys(entry).length;
        expect(entry.propType?.length).toBeLessThanOrEqual(10);
        expect(entry.reactivity).toBe("reactive");
      }
    }
    expect(stateNodes + metadataNodes).toBeLessThanOrEqual(HARD_MAX_NODES);
    expect(
      Object.keys(result.data.metadata ?? {}).length,
    ).toBeLessThan(sections.length);
    for (const [section, entries] of Object.entries(
      result.data.metadata ?? {},
    )) {
      const serialized = result.data.state[
        section as keyof typeof result.data.state
      ];
      const stateKeys = serialized && !("$type" in serialized)
        ? Object.keys(serialized)
        : [];
      expect(Object.keys(entries).every((key) => stateKeys.includes(key))).toBe(
        true,
      );
    }
  });

  it("safely bounds hostile facade contract errors", async () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "message", {
      get() {
        throw new Error("message trap");
      },
    });
    hostile.toString = () => {
      throw new Error("toString trap");
    };
    const api = createProbeAPI(
      sourceFixture({
        getComponentState: async () => {
          throw hostile;
        },
      }),
    );
    await expect(api.getComponentState("app:1")).resolves.toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Internal error" },
    });
  });

  it("serializes component sections canonically and Pinia state first", async () => {
    const accesses: string[] = [];
    const tracked = (label: string) => {
      const map = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(map, "value", {
        enumerable: true,
        get() {
          accesses.push(label);
          return label;
        },
      });
      return map;
    };
    const api = createProbeAPI(
      sourceFixture({
        getComponentState: async () => ({
          appId: "app",
          componentId: "app:1",
          name: "Child",
          state: { data: tracked("data"), props: tracked("props") },
        }),
        getPiniaState: async () => ({
          appId: "app",
          storeId: "users",
          state: tracked("state"),
          getters: tracked("getters"),
          customProperties: tracked("custom"),
        }),
      }),
    );

    const component = await api.getComponentState("app:1");
    expect(component).toMatchObject({ ok: true });
    expect(accesses).toEqual(["props", "data"]);
    accesses.length = 0;
    const pinia = await api.getPiniaState("users");
    expect(pinia).toMatchObject({ ok: true });
    expect(accesses).toEqual(["state", "getters", "custom"]);
  });

  it("returns stale and not-ready failures instead of throwing", async () => {
    const api = createProbeAPI(sourceFixture());
    await expect(
      api.getComponentState("app:1", { expectedRevision: 3 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "STALE_REVISION" } });
    const unavailable = createProbeAPI(
      sourceFixture({ listApps: () => [], getActiveAppId: () => undefined }),
    );
    await expect(unavailable.getComponentTree()).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_READY" },
    });
    await expect(
      api.getComponentState("app:1", { maxEntries: 201 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_OPTIONS" } });
  });

  it("returns component DOM through the same envelope", async () => {
    const api = createProbeAPI(sourceFixture());
    expect(await api.getComponentDOM("app:1")).toMatchObject({
      ok: true,
      data: { appId: "app", componentId: "app:1", roots: [] },
      meta: { revision: 4 },
    });
  });
});
