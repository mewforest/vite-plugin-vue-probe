import { describe, expect, it, vi } from "vitest";
import { createQueryExecutor } from "../src/query/executor";
import type { ProbeQueryOperations } from "../src/query/executor";
import type { AppPlan, QueryPlan } from "../src/query/plan";
import type {
  AppSummary,
  ComponentDOMResult,
  ComponentFromDOMResult,
  ComponentStateResult,
  ComponentTreeResult,
  DetailedStateResult,
  PiniaStateResult,
  PiniaStoreSummary,
  ProbeResult,
  ResponseMeta,
} from "../src/public-types";

const meta = (revision = 7): ResponseMeta => ({
  requestId: `probe-${revision}`,
  revision,
  observedAt: "2026-07-18T00:00:00.000Z",
});

function success<T>(data: T, revision = 7): ProbeResult<T> {
  return { ok: true, data, meta: meta(revision) };
}

function failure(
  code: "NOT_READY" | "STALE_REVISION",
  revision = 0,
): ProbeResult<never> {
  return {
    ok: false,
    error: { code, message: code.toLowerCase().replaceAll("_", " ") },
    meta: meta(revision),
  };
}

const apps: AppSummary[] = [
  { id: "first", name: "First", vueVersion: "3.5.0", active: false },
  { id: "active", name: "Demo", vueVersion: "3.5.0", active: true },
  { id: "admin", name: "Admin", vueVersion: "3.5.0", active: false },
];

const tree: ComponentTreeResult = {
  appId: "active",
  rootId: "root",
  format: "flat",
  truncatedByDepth: false,
  nodes: [
    {
      id: "deep-1",
      name: "Card",
      parentId: "shallow-1",
      depth: 2,
      hasChildren: false,
    },
    {
      id: "shallow-2",
      name: "Card",
      parentId: "root",
      depth: 1,
      hasChildren: false,
    },
    {
      id: "shallow-1",
      name: "Card",
      parentId: "root",
      depth: 1,
      hasChildren: true,
    },
  ],
};

const componentState: ComponentStateResult = {
  appId: "active",
  componentId: "shallow-1",
  name: "Card",
  state: { props: { item: "Ada" } },
};

const detailedState: DetailedStateResult = {
  target: {
    kind: "component",
    appId: "active",
    componentId: "shallow-1",
  },
  path: ["setup", "rows"],
  value: [{ id: 51 }],
  page: {
    offset: 50,
    limit: 50,
    returned: 1,
    total: 51,
    nextOffset: null,
  },
};

const stores: PiniaStoreSummary[] = [
  { appId: "active", id: "users" },
  { appId: "active", id: "session" },
];

const piniaState: PiniaStateResult = {
  appId: "active",
  storeId: "users",
  state: { list: ["Ada"] },
};

const componentDOM: ComponentDOMResult = {
  appId: "active",
  componentId: "shallow-1",
  roots: [],
};

const fromDOM: ComponentFromDOMResult = {
  appId: "active",
  componentId: "shallow-1",
  name: "Card",
};

function operationsFixture(): ProbeQueryOperations {
  return {
    formatters: {
      stateToPaths: vi.fn(() => ""),
      toMarkdown: vi.fn(() => ""),
      domToTable: vi.fn(() => ""),
      treeToMermaid: vi.fn(() => ""),
      toCleanJson: vi.fn(() => "{}"),
    },
    listApps: vi.fn(async () => success(apps)),
    getComponentTree: vi.fn(async () => success(tree)),
    getComponentState: vi.fn(async () => success(componentState)),
    getDetailedState: vi.fn(async () => success(detailedState)),
    getPiniaStores: vi.fn(async () => success(stores)),
    getPiniaState: vi.fn(async () => success(piniaState)),
    getComponentDOM: vi.fn(async () => success(componentDOM)),
    getComponentFromDOM: vi.fn(async () => success(fromDOM, 9)),
  };
}

const appPlan = (selector: AppPlan["selector"] = { kind: "default" }): AppPlan =>
  ({ kind: "app", selector });

describe("query executor app and component selection", () => {
  it("selects active, exact-id, and first exact-name apps", async () => {
    const execute = createQueryExecutor(operationsFixture()).execute;

    await expect(execute(appPlan())).resolves.toMatchObject({ id: "active" });
    await expect(
      execute(appPlan({ kind: "id", id: "admin" })),
    ).resolves.toMatchObject({ id: "admin" });
    await expect(
      execute(appPlan({ kind: "name", name: "Admin" })),
    ).resolves.toMatchObject({ id: "admin" });
  });

  it("falls back to the first app when none is active", async () => {
    const operations = operationsFixture();
    vi.mocked(operations.listApps).mockResolvedValue(
      success(apps.map((app) => ({ ...app, active: false }))),
    );

    await expect(createQueryExecutor(operations).execute(appPlan())).resolves.toMatchObject(
      { id: "first" },
    );
  });

  it("lists all apps without selecting one", async () => {
    await expect(
      createQueryExecutor(operationsFixture()).execute({ kind: "apps" }),
    ).resolves.toEqual(apps);
  });

  it("uses one full-depth filtered tree and stable breadth-first nth selection", async () => {
    const operations = operationsFixture();
    const plan: QueryPlan = {
      kind: "component",
      app: appPlan(),
      name: "Card",
      index: 1,
    };

    await expect(createQueryExecutor(operations).execute(plan)).resolves.toMatchObject({
      id: "shallow-1",
    });
    expect(operations.getComponentTree).toHaveBeenCalledWith({
      appId: "active",
      filter: "Card",
      format: "flat",
      maxDepth: null,
      includeFile: false,
    });
  });

  it("returns plural matches in stable breadth-first order", async () => {
    const plan: QueryPlan = {
      kind: "components",
      app: appPlan(),
      name: "Card",
    };

    await expect(
      createQueryExecutor(operationsFixture()).execute(plan),
    ).resolves.toMatchObject([
      { id: "shallow-2" },
      { id: "shallow-1" },
      { id: "deep-1" },
    ]);
  });

  it("forwards explicit tree options and executes fresh on every run", async () => {
    const operations = operationsFixture();
    const executor = createQueryExecutor(operations);
    const plan: QueryPlan = {
      kind: "tree",
      app: appPlan(),
      options: { format: "nested", maxDepth: 10, includeFile: true },
    };

    await executor.execute(plan);
    await executor.execute(plan);

    expect(operations.getComponentTree).toHaveBeenCalledTimes(2);
    expect(operations.getComponentTree).toHaveBeenLastCalledWith({
      appId: "active",
      format: "nested",
      maxDepth: 10,
      includeFile: true,
    });
  });

  it("turns facade failures into ProbeQueryError with safe context", async () => {
    const operations = operationsFixture();
    vi.mocked(operations.listApps).mockResolvedValue(failure("NOT_READY"));

    await expect(createQueryExecutor(operations).execute({ kind: "apps" })).rejects.toMatchObject({
      name: "ProbeQueryError",
      code: "NOT_READY",
      step: "list-apps",
      meta: { revision: 0 },
      query: "apps",
    });
  });

  it("uses query-owned not-found errors for missing selections", async () => {
    const executor = createQueryExecutor(operationsFixture());

    await expect(
      executor.execute(appPlan({ kind: "id", id: "missing" })),
    ).rejects.toMatchObject({ code: "APP_NOT_FOUND", step: "resolve-app" });
    await expect(
      executor.execute({
        kind: "component",
        app: appPlan(),
        name: "Missing",
        index: 0,
      }),
    ).rejects.toMatchObject({
      code: "COMPONENT_NOT_FOUND",
      step: "find-component",
    });
  });
});

describe("query executor state, Pinia, and DOM", () => {
  it("forwards component-tree revision to full and detailed state", async () => {
    const operations = operationsFixture();
    const component: QueryPlan = {
      kind: "component",
      app: appPlan(),
      name: "Card",
      index: 1,
    };

    await createQueryExecutor(operations).execute({
      kind: "component-state",
      component,
      options: { includeMetadata: true },
    });
    await createQueryExecutor(operations).execute({
      kind: "detailed-state",
      target: component,
      path: ["setup", "rows"],
      options: { maxDepth: 4 },
      page: { offset: 50, limit: 50 },
    });

    expect(operations.getComponentState).toHaveBeenCalledWith("shallow-1", {
      includeMetadata: true,
      appId: "active",
      expectedRevision: 7,
    });
    expect(operations.getDetailedState).toHaveBeenCalledWith(
      {
        kind: "component",
        appId: "active",
        componentId: "shallow-1",
      },
      ["setup", "rows"],
      {
        maxDepth: 4,
        expectedRevision: 7,
        offset: 50,
        limit: 50,
      },
    );
  });

  it("lists Pinia stores, selects exact summaries, and reads state directly", async () => {
    const operations = operationsFixture();
    const executor = createQueryExecutor(operations);
    const storePlan: QueryPlan = {
      kind: "pinia-store",
      app: appPlan(),
      storeId: "users",
    };

    await expect(
      executor.execute({ kind: "pinia-stores", app: appPlan(), options: {} }),
    ).resolves.toEqual(stores);
    await expect(executor.execute(storePlan)).resolves.toEqual(stores[0]);
    vi.mocked(operations.getPiniaStores).mockClear();
    await executor.execute({
      kind: "pinia-state",
      store: storePlan,
      options: { maxDepth: 3 },
    });

    expect(operations.getPiniaState).toHaveBeenCalledWith("users", {
      maxDepth: 3,
      appId: "active",
    });
    expect(operations.getPiniaStores).not.toHaveBeenCalled();
  });

  it("reads detailed Pinia state without a preliminary store list", async () => {
    const operations = operationsFixture();
    const store: QueryPlan = {
      kind: "pinia-store",
      app: appPlan(),
      storeId: "users",
    };

    await createQueryExecutor(operations).execute({
      kind: "detailed-state",
      target: store,
      path: ["list", 0],
      options: {},
    });

    expect(operations.getDetailedState).toHaveBeenCalledWith(
      { kind: "pinia", appId: "active", storeId: "users" },
      ["list", 0],
      {},
    );
    expect(operations.getPiniaStores).not.toHaveBeenCalled();
  });

  it("forwards component revision to DOM reads", async () => {
    const operations = operationsFixture();
    await createQueryExecutor(operations).execute({
      kind: "component-dom",
      component: {
        kind: "component",
        app: appPlan(),
        name: "Card",
        index: 1,
      },
      options: {},
    });

    expect(operations.getComponentDOM).toHaveBeenCalledWith("shallow-1", {
      appId: "active",
      expectedRevision: 7,
    });
  });

  it("carries DOM-resolved identity and revision into detailed state", async () => {
    const operations = operationsFixture();
    const target: QueryPlan = {
      kind: "component-from-dom",
      app: appPlan(),
      target: "#card",
      options: {},
    };

    await expect(createQueryExecutor(operations).execute(target)).resolves.toEqual(
      fromDOM,
    );
    await createQueryExecutor(operations).execute({
      kind: "detailed-state",
      target,
      path: ["props", "item"],
      options: {},
    });

    expect(operations.getComponentFromDOM).toHaveBeenCalledWith("#card", {
      appId: "active",
    });
    expect(operations.getDetailedState).toHaveBeenCalledWith(
      {
        kind: "component",
        appId: "active",
        componentId: "shallow-1",
      },
      ["props", "item"],
      { expectedRevision: 9 },
    );
  });

  it("preserves downstream stale-revision failures", async () => {
    const operations = operationsFixture();
    vi.mocked(operations.getComponentState).mockResolvedValue(
      failure("STALE_REVISION", 8),
    );

    await expect(
      createQueryExecutor(operations).execute({
        kind: "component-state",
        component: {
          kind: "component",
          app: appPlan(),
          name: "Card",
          index: 1,
        },
        options: {},
      }),
    ).rejects.toMatchObject({
      code: "STALE_REVISION",
      step: "read-component-state",
      meta: { revision: 8 },
    });
  });
});
