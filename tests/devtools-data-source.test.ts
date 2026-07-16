import { describe, expect, it, vi } from "vitest";
import { devtools } from "@vue/devtools-kit";
import {
  createKitBridge,
  DevtoolsDataSource,
  type DevtoolsBridge,
} from "../src/data-source/devtools";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function bridgeFixture() {
  let active: string | undefined = "a";
  let apps = [
    { id: "a", name: "App A", version: "3.5.0" },
    { id: "b", name: "App B" },
  ];
  const revisions = new Set<(appId?: string) => void>();
  let customRevisionDisposers: Array<() => void> | undefined;
  let inspectorPresent = true;
  const bridge = {
    init: vi.fn(),
    getApps: () => apps,
    getActiveAppId: () => active,
    toggleApp: vi.fn((id: string) => {
      active = id;
    }),
    hasInspector: vi.fn(() => inspectorPresent),
    getInspectorTree: vi.fn(async (inspector: "components" | "pinia") =>
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
    getInspectorState: vi.fn(
      async (inspector: "components" | "pinia", nodeId: string) =>
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
    getComponentRoots: vi.fn((): Element[] | undefined => []),
    onRevision: (callback: (appId?: string) => void) => {
      revisions.add(callback);
      return (
        customRevisionDisposers ?? [() => void revisions.delete(callback)]
      );
    },
  };
  return {
    bridge: bridge as DevtoolsBridge,
    emitRevision: (appId?: string) =>
      revisions.forEach((callback) => callback(appId)),
    revisionListenerCount: () => revisions.size,
    setInspectorPresent: (present: boolean) => {
      inspectorPresent = present;
    },
    removeApp: (appId: string) => {
      apps = apps.filter((app) => app.id !== appId);
    },
    addApp: (appId: string) => {
      apps = [...apps, { id: appId, name: `App ${appId.toUpperCase()}` }];
    },
    setActive: (appId: string | undefined) => {
      active = appId;
    },
    setRevisionDisposers: (disposers: Array<() => void>) => {
      customRevisionDisposers = disposers;
    },
  };
}

describe("DevtoolsDataSource", () => {
  it("initializes once, disposes subscriptions, and can initialize again", () => {
    const fixture = bridgeFixture();
    const source = new DevtoolsDataSource(fixture.bridge);

    source.init();
    source.init();

    expect(fixture.bridge.init).toHaveBeenCalledOnce();
    expect(fixture.revisionListenerCount()).toBe(1);
    expect(source.dispose).toBeTypeOf("function");
    source.dispose();
    expect(fixture.revisionListenerCount()).toBe(0);

    source.init();
    expect(fixture.bridge.init).toHaveBeenCalledOnce();
    expect(fixture.revisionListenerCount()).toBe(1);
  });

  it("retries failed listener registration without initializing the bridge twice", () => {
    const fixture = bridgeFixture();
    const registration = vi.spyOn(fixture.bridge, "onRevision");
    registration.mockImplementationOnce(() => {
      throw new Error("listener registration failed");
    });
    const source = new DevtoolsDataSource(fixture.bridge);

    expect(() => source.init()).toThrow("listener registration failed");
    expect(fixture.bridge.init).toHaveBeenCalledOnce();

    source.init();
    expect(fixture.bridge.init).toHaveBeenCalledOnce();
    expect(fixture.revisionListenerCount()).toBe(1);
  });

  it("rolls back partial typed-kit listener registration before retry", () => {
    const failedAddedCleanup = vi.fn();
    const failedUpdatedCleanup = vi.fn(() => {
      throw new Error("updated cleanup failed");
    });
    const retryAddedCleanup = vi.fn();
    const retryUpdatedCleanup = vi.fn();
    const removedCleanup = vi.fn();
    const inspectorCleanup = vi.fn();
    const componentAdded = vi
      .spyOn(devtools.hook.on, "componentAdded")
      .mockReturnValueOnce(failedAddedCleanup)
      .mockReturnValue(retryAddedCleanup);
    const componentUpdated = vi
      .spyOn(devtools.hook.on, "componentUpdated")
      .mockReturnValueOnce(failedUpdatedCleanup)
      .mockReturnValue(retryUpdatedCleanup);
    const componentRemoved = vi
      .spyOn(devtools.hook.on, "componentRemoved")
      .mockReturnValue(removedCleanup);
    componentRemoved.mockImplementationOnce(() => {
      throw new Error("componentRemoved registration failed");
    });
    const inspectorState = vi
      .spyOn(devtools.ctx.hooks, "hook")
      .mockReturnValue(inspectorCleanup);

    try {
      const bridge = createKitBridge();
      expect(() => bridge.onRevision(() => undefined)).toThrow(
        "componentRemoved registration failed",
      );
      expect(failedAddedCleanup).toHaveBeenCalledOnce();
      expect(failedUpdatedCleanup).toHaveBeenCalledOnce();
      expect(componentRemoved).toHaveBeenCalledOnce();
      expect(inspectorState).not.toHaveBeenCalled();

      const disposers = bridge.onRevision(() => undefined);
      expect(disposers).toHaveLength(4);
      disposers.forEach((dispose) => dispose());
      expect(retryAddedCleanup).toHaveBeenCalledOnce();
      expect(retryUpdatedCleanup).toHaveBeenCalledOnce();
      expect(removedCleanup).toHaveBeenCalledOnce();
      expect(inspectorCleanup).toHaveBeenCalledOnce();
      expect(componentAdded).toHaveBeenCalledTimes(2);
      expect(componentRemoved).toHaveBeenCalledTimes(2);
    } finally {
      componentAdded.mockRestore();
      componentUpdated.mockRestore();
      componentRemoved.mockRestore();
      inspectorState.mockRestore();
    }
  });

  it("forwards an unattributed typed-kit component update to conservative invalidation", () => {
    let updated!: (app?: unknown) => void;
    const cleanup = vi.fn();
    const added = vi.spyOn(devtools.hook.on, "componentAdded").mockReturnValue(cleanup);
    const componentUpdated = vi
      .spyOn(devtools.hook.on, "componentUpdated")
      .mockImplementation((callback) => {
        updated = callback as (app?: unknown) => void;
        return cleanup;
      });
    const removed = vi.spyOn(devtools.hook.on, "componentRemoved").mockReturnValue(cleanup);
    const inspector = vi.spyOn(devtools.ctx.hooks, "hook").mockReturnValue(cleanup);
    const callback = vi.fn();
    try {
      createKitBridge().onRevision(callback);
      updated();
      expect(callback).toHaveBeenCalledWith(undefined);
    } finally {
      added.mockRestore();
      componentUpdated.mockRestore();
      removed.mockRestore();
      inspector.mockRestore();
    }
  });

  it("serializes delayed app reads and restores the previous active app", async () => {
    const fixture = bridgeFixture();
    const firstRead = deferred<unknown[]>();
    let reads = 0;
    vi.mocked(fixture.bridge.getInspectorTree).mockImplementation(
      async (inspector) => {
        if (inspector !== "components") return [];
        reads += 1;
        if (reads === 1) return firstRead.promise;
        return [{ id: `${fixture.bridge.getActiveAppId()}:root`, name: "Root" }];
      },
    );
    const source = new DevtoolsDataSource(fixture.bridge);

    const appB = source.getComponentTree("b");
    await vi.waitFor(() => expect(fixture.bridge.getActiveAppId()).toBe("b"));
    const appA = source.getComponentTree("a");
    await Promise.resolve();
    expect(reads).toBe(1);

    firstRead.resolve([{ id: "b:root", name: "Root" }]);
    await expect(appB).resolves.toMatchObject({ appId: "b" });
    await expect(appA).resolves.toMatchObject({
      appId: "a",
      nodes: [{ id: "a:root" }],
    });
    expect(fixture.bridge.getActiveAppId()).toBe("a");
  });

  it("restores the previous app when an inspector read fails", async () => {
    const fixture = bridgeFixture();
    vi.mocked(fixture.bridge.getInspectorTree).mockRejectedValueOnce(
      new Error("bridge failed"),
    );
    const source = new DevtoolsDataSource(fixture.bridge);

    await expect(source.getComponentTree("b")).rejects.toThrow("bridge failed");
    expect(fixture.bridge.getActiveAppId()).toBe("a");
  });

  it("does not overwrite an external active-app change during an async read", async () => {
    const fixture = bridgeFixture();
    fixture.addApp("c");
    const tree = deferred<unknown[]>();
    vi.mocked(fixture.bridge.getInspectorTree).mockReturnValueOnce(tree.promise);
    const source = new DevtoolsDataSource(fixture.bridge);

    const appB = source.getComponentTree("b");
    await vi.waitFor(() => expect(fixture.bridge.getActiveAppId()).toBe("b"));
    fixture.setActive("c");
    tree.resolve([{ id: "b:root", name: "Root" }]);

    await appB;
    expect(fixture.bridge.getActiveAppId()).toBe("c");
  });

  it("restores after toggleApp partially selects and then throws", async () => {
    const fixture = bridgeFixture();
    vi.mocked(fixture.bridge.toggleApp).mockImplementationOnce((appId) => {
      fixture.setActive(appId);
      throw new Error("partial toggle failure");
    });
    const source = new DevtoolsDataSource(fixture.bridge);

    await expect(source.getComponentTree("b")).rejects.toThrow(
      "partial toggle failure",
    );
    expect(fixture.bridge.getActiveAppId()).toBe("a");
    expect(fixture.bridge.toggleApp).toHaveBeenLastCalledWith("a");
  });

  it("leaves the selected app active when there was no previous app", async () => {
    const fixture = bridgeFixture();
    fixture.setActive(undefined);
    const source = new DevtoolsDataSource(fixture.bridge);

    await source.getComponentTree("b");

    expect(fixture.bridge.getActiveAppId()).toBe("b");
  });

  it("restores an in-flight async app selection after a synchronous DOM read", async () => {
    const fixture = bridgeFixture();
    const tree = deferred<unknown[]>();
    vi.mocked(fixture.bridge.getInspectorTree).mockReturnValueOnce(tree.promise);
    const source = new DevtoolsDataSource(fixture.bridge);

    const appB = source.getComponentTree("b");
    await vi.waitFor(() => expect(fixture.bridge.getActiveAppId()).toBe("b"));
    const togglesBeforeDOMRead = vi.mocked(fixture.bridge.toggleApp).mock.calls
      .length;

    expect(source.getComponentRoots("a", "a:1")).toEqual([]);
    expect(fixture.bridge.getActiveAppId()).toBe("b");
    expect(fixture.bridge.toggleApp).toHaveBeenCalledTimes(togglesBeforeDOMRead);
    expect(fixture.bridge.getComponentRoots).toHaveBeenCalledWith("a", "a:1");

    tree.resolve([{ id: "b:root", name: "Root" }]);
    await appB;
    expect(fixture.bridge.getActiveAppId()).toBe("a");
  });

  it("lists Pinia store IDs without reading state by default", async () => {
    const fixture = bridgeFixture();
    const source = new DevtoolsDataSource(fixture.bridge);

    await expect(source.getPiniaStores("b")).resolves.toEqual([
      { appId: "b", id: "users" },
    ]);
    expect(fixture.bridge.getInspectorState).not.toHaveBeenCalled();
    expect(fixture.bridge.getActiveAppId()).toBe("a");
  });

  it("loads optional Pinia keys with at most four concurrent state reads", async () => {
    const fixture = bridgeFixture();
    const stores = Array.from({ length: 9 }, (_, index) => ({
      id: `store-${index}`,
      label: `Store ${index}`,
    }));
    vi.mocked(fixture.bridge.getInspectorTree).mockResolvedValue(stores);
    let activeReads = 0;
    let peakReads = 0;
    vi.mocked(fixture.bridge.getInspectorState).mockImplementation(
      async (_inspector, nodeId) => {
        activeReads += 1;
        peakReads = Math.max(peakReads, activeReads);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeReads -= 1;
        return {
          state: [{ key: `${nodeId}-state`, value: true }],
          getters: [{ key: `${nodeId}-getter`, value: true }],
        };
      },
    );
    const source = new DevtoolsDataSource(fixture.bridge);

    const result = await source.getPiniaStores("a", "", true);

    expect(result).toHaveLength(9);
    expect(result[0]).toMatchObject({
      stateKeys: ["store-0-state"],
      getterKeys: ["store-0-getter"],
    });
    expect(peakReads).toBeLessThanOrEqual(4);
  });

  it("stops scheduling Pinia key reads after failure and drains active workers before restoring", async () => {
    const fixture = bridgeFixture();
    const stores = Array.from({ length: 8 }, (_, index) => ({
      id: `store-${index}`,
      label: `Store ${index}`,
    }));
    vi.mocked(fixture.bridge.getInspectorTree).mockImplementation(
      async (inspector) =>
        inspector === "pinia"
          ? stores
          : [{ id: `${fixture.bridge.getActiveAppId()}:root`, name: "Root" }],
    );
    const activeReads = new Map<string, ReturnType<typeof deferred<unknown>>>();
    const started: string[] = [];
    vi.mocked(fixture.bridge.getInspectorState).mockImplementation(
      async (_inspector, nodeId) => {
        started.push(nodeId);
        if (nodeId === "store-0") throw new Error("first worker failure");
        const read = deferred<unknown>();
        activeReads.set(nodeId, read);
        return read.promise;
      },
    );
    const source = new DevtoolsDataSource(fixture.bridge);

    const failedListing = source.getPiniaStores("b", "", true);
    await vi.waitFor(() => expect(started).toHaveLength(4));
    const queuedAppA = source.getComponentTree("a");
    await Promise.resolve();

    expect(fixture.bridge.getActiveAppId()).toBe("b");
    expect(started).toEqual([
      "store-0",
      "store-1",
      "store-2",
      "store-3",
    ]);

    for (const read of activeReads.values())
      read.resolve({ state: [{ key: "value", value: true }] });

    await expect(failedListing).rejects.toThrow("first worker failure");
    await expect(queuedAppA).resolves.toMatchObject({ appId: "a" });
    expect(started).toHaveLength(4);
    expect(fixture.bridge.getActiveAppId()).toBe("a");
  });

  it("aborts Pinia key enrichment when DevTools switches apps after the tree read started", async () => {
    const fixture = bridgeFixture();
    fixture.addApp("c");
    const tree = deferred<unknown[]>();
    vi.mocked(fixture.bridge.getInspectorTree).mockReturnValueOnce(tree.promise);
    const source = new DevtoolsDataSource(fixture.bridge);

    const listing = source.getPiniaStores("b", "", true);
    await vi.waitFor(() => expect(fixture.bridge.getActiveAppId()).toBe("b"));
    fixture.setActive("c");
    tree.resolve([{ id: "users", label: "Users" }]);

    await expect(listing).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: expect.stringContaining("active app changed"),
    });
    expect(fixture.bridge.getInspectorState).not.toHaveBeenCalled();
    expect(fixture.bridge.getActiveAppId()).toBe("c");
  });

  it("returns no Pinia stores only when the inspector is confirmed absent", async () => {
    const fixture = bridgeFixture();
    fixture.setInspectorPresent(false);
    const source = new DevtoolsDataSource(fixture.bridge);

    await expect(source.getPiniaStores("a")).resolves.toEqual([]);
    expect(fixture.bridge.getInspectorTree).not.toHaveBeenCalled();
  });

  it("reports real Pinia inspector failures as INTERNAL_ERROR", async () => {
    const fixture = bridgeFixture();
    vi.mocked(fixture.bridge.getInspectorTree).mockRejectedValueOnce(
      new Error("pinia bridge failed"),
    );
    const source = new DevtoolsDataSource(fixture.bridge);

    await expect(source.getPiniaStores("a")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: expect.stringContaining("Pinia inspector tree"),
    });
  });

  it("wraps hostile Pinia inspector payload traps as INTERNAL_ERROR", async () => {
    const fixture = bridgeFixture();
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("hostile inspector payload");
        },
      },
    );
    vi.mocked(fixture.bridge.getInspectorState).mockResolvedValueOnce(hostile);
    const source = new DevtoolsDataSource(fixture.bridge);

    await expect(source.getPiniaState("a", "users")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: expect.stringContaining("Pinia inspector state"),
    });
  });

  it("maintains revision per app and stops updates after dispose", () => {
    const fixture = bridgeFixture();
    const source = new DevtoolsDataSource(fixture.bridge);
    source.init();
    fixture.emitRevision("a");
    fixture.emitRevision("a");
    expect(source.getRevision("a")).toBe(2);

    source.dispose();
    fixture.emitRevision("a");
    expect(source.getRevision("a")).toBe(2);
  });

  it("runs every disposer, clears lifecycle state before cleanup, and rethrows the first error", () => {
    const fixture = bridgeFixture();
    const calls: string[] = [];
    fixture.setRevisionDisposers([
      () => {
        calls.push("first");
        throw new Error("first dispose failure");
      },
      () => {
        calls.push("second");
        throw new Error("second dispose failure");
      },
      () => calls.push("third"),
    ]);
    const source = new DevtoolsDataSource(fixture.bridge);
    source.init();

    expect(() => source.dispose()).toThrow("first dispose failure");
    expect(calls).toEqual(["first", "second", "third"]);
    expect(() => source.dispose()).not.toThrow();
  });

  it("invalidates every live app when a revision signal is unattributed", () => {
    const fixture = bridgeFixture();
    const source = new DevtoolsDataSource(fixture.bridge);
    source.init();

    fixture.emitRevision();

    expect(source.getRevision("a")).toBe(1);
    expect(source.getRevision("b")).toBe(1);
  });

  it("drops revision state for applications removed by DevTools", () => {
    const fixture = bridgeFixture();
    const source = new DevtoolsDataSource(fixture.bridge);
    source.init();
    fixture.emitRevision("b");
    expect(source.getRevision("b")).toBe(1);

    fixture.removeApp("b");
    source.listApps();

    expect(source.getRevision("b")).toBe(0);
  });

  it("rejects malformed inspector tree nodes instead of stringifying missing IDs", async () => {
    const fixture = bridgeFixture();
    vi.mocked(fixture.bridge.getInspectorTree).mockResolvedValueOnce([
      { name: "Missing id" },
    ]);
    const source = new DevtoolsDataSource(fixture.bridge);

    await expect(source.getComponentTree("a")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("wraps hostile component state entry accessors as INTERNAL_ERROR", async () => {
    const fixture = bridgeFixture();
    const entry = { key: "hostile" } as Record<string, unknown>;
    Object.defineProperty(entry, "value", {
      get() {
        throw new Error("hostile component state");
      },
    });
    vi.mocked(fixture.bridge.getInspectorState).mockResolvedValueOnce({
      id: "a:1",
      name: "Child",
      state: [entry],
    });
    const source = new DevtoolsDataSource(fixture.bridge);

    await expect(source.getComponentState("a", "a:1")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: expect.stringContaining("components inspector state"),
    });
  });

  it("keeps hasChildren true when validated children are present", async () => {
    const fixture = bridgeFixture();
    vi.mocked(fixture.bridge.getInspectorTree).mockResolvedValueOnce([
      {
        id: "root",
        name: "Root",
        hasChildren: false,
        children: [{ id: "child", name: "Child" }],
      },
    ]);
    const source = new DevtoolsDataSource(fixture.bridge);

    await expect(source.getComponentTree("a")).resolves.toMatchObject({
      nodes: [{ hasChildren: true }],
    });
  });

  it("rejects cyclic component and Pinia inspector trees", async () => {
    const fixture = bridgeFixture();
    const component: Record<string, unknown> = { id: "root", name: "Root" };
    component.children = [component];
    vi.mocked(fixture.bridge.getInspectorTree).mockResolvedValueOnce([
      component,
    ]);
    const source = new DevtoolsDataSource(fixture.bridge);

    await expect(source.getComponentTree("a")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });

    const store: Record<string, unknown> = { id: "store", label: "Store" };
    store.children = [store];
    vi.mocked(fixture.bridge.getInspectorTree).mockResolvedValueOnce([store]);
    await expect(source.getPiniaStores("a")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("rejects component trees deeper than 1000 without overflowing the stack", async () => {
    const fixture = bridgeFixture();
    const root: Record<string, unknown> = { id: "node-0", name: "Node 0" };
    let cursor = root;
    for (let depth = 1; depth <= 1_001; depth += 1) {
      const child: Record<string, unknown> = {
        id: `node-${depth}`,
        name: `Node ${depth}`,
      };
      cursor.children = [child];
      cursor = child;
    }
    vi.mocked(fixture.bridge.getInspectorTree).mockResolvedValueOnce([root]);
    const source = new DevtoolsDataSource(fixture.bridge);

    await expect(source.getComponentTree("a")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: expect.stringContaining("depth"),
    });
  });

  it("rejects inspector trees larger than 10000 nodes", async () => {
    const fixture = bridgeFixture();
    let indexedReads = 0;
    const oversized = new Proxy(
      Array.from({ length: 10_001 }, (_, index) => ({
        id: `store-${index}`,
        label: `Store ${index}`,
      })),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property))
            indexedReads += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    vi.mocked(fixture.bridge.getInspectorTree).mockResolvedValueOnce(
      oversized,
    );
    const source = new DevtoolsDataSource(fixture.bridge);

    await expect(source.getPiniaStores("a")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: expect.stringContaining("10000"),
    });
    expect(indexedReads).toBe(0);
  });

  it("reports an unknown DOM component and restores app selection", () => {
    const fixture = bridgeFixture();
    vi.mocked(fixture.bridge.getComponentRoots).mockReturnValueOnce(
      undefined as never,
    );
    const source = new DevtoolsDataSource(fixture.bridge);

    expect(() => source.getComponentRoots("b", "missing")).toThrowError(
      expect.objectContaining({ code: "COMPONENT_NOT_FOUND" }),
    );
    expect(fixture.bridge.getActiveAppId()).toBe("a");
    expect(fixture.bridge.toggleApp).not.toHaveBeenCalled();
  });

  it("reports missing applications", async () => {
    const fixture = bridgeFixture();
    const source = new DevtoolsDataSource(fixture.bridge);
    await expect(source.getComponentTree("missing")).rejects.toMatchObject({
      code: "APP_NOT_FOUND",
    });
  });
});
