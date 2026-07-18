# Vue Probe Fluent Query API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved lazy, immutable `window.VUE_PROBE.query` API while preserving the existing envelope-based `ProbeAPI` behavior.

**Architecture:** Typed builders create immutable discriminated query plans. A query runtime executes those plans exclusively through the existing facade, carries app identity and app-specific revisions, unwraps failures into `ProbeQueryError`, and delegates terminal display to a type-aware renderer.

**Tech Stack:** TypeScript 5.9, ES2022, Vitest 4, Vite 8, jsdom, existing Vue Probe facade and formatters.

## Global Constraints

- The existing `ProbeAPI` methods, envelopes, validation, formatters, and data-source behavior remain source- and behavior-compatible.
- Query construction performs no Vue, Pinia, DOM, or facade reads.
- Only `run()` and `show()` execute a plan; query objects are not thenable.
- Query builders are immutable and reusable.
- The executor accesses runtime data only through existing facade-shaped operations, never `ProbeDataSource`.
- `appId`, `expectedRevision`, detailed `offset`, and detailed `limit` are context-owned and cannot be overridden through later query options.
- Automatic unbounded pagination is out of scope.
- No new runtime dependency is allowed.
- Use TDD for every behavior change and keep commits task-scoped.

---

## File structure

- Create `src/query/types.ts`: public query interfaces, format/result mapping, and query-specific option types.
- Create `src/query/path.ts`: dot-path normalization and validation.
- Create `src/query/plan.ts`: internal discriminated plans, runtime interface, and safe plan labels.
- Create `src/query/builder.ts`: frozen immutable query builders and terminal method wiring.
- Create `src/query/error.ts`: `ProbeQueryError` and failure unwrapping.
- Create `src/query/executor.ts`: facade-only plan execution and revision propagation.
- Create `src/query/renderer.ts`: allowed-format validation, formatting, console dispatch, and return values.
- Create `src/query/index.ts`: compose executor, renderer, and builders into `createProbeQueryAPI()`.
- Create `tests/query-path.test.ts`: path grammar tests.
- Create `tests/query-builder.test.ts`: laziness, immutability, and plan construction tests.
- Create `tests/query-executor.test.ts`: app, tree, component, Pinia, state, and DOM execution tests.
- Create `tests/query-renderer.test.ts`: format defaults, console behavior, and renderer failures.
- Modify `src/public-types.ts`: attach `query` to `ProbeAPI` and import the query root type.
- Modify `src/core/facade.ts`: construct the core facade, create one query namespace over it, and return the combined API.
- Modify `src/index.ts` and `src/client.ts`: export query types and `ProbeQueryError` from package entry points.
- Modify `tests/client.test.ts`: browser installation, freezing, and lifecycle regression coverage.
- Modify `tests/types-dist/consumer.ts`: emitted declaration success and expected-error cases.
- Modify `README.md`, `README_ru.md`, and `skills/vue-probe/SKILL.md`: parallel fluent examples and agent guidance.

---

### Task 1: Query path grammar

**Files:**
- Create: `src/query/path.ts`
- Create: `tests/query-path.test.ts`

**Interfaces:**
- Consumes: `StatePath` from `src/public-types.ts`.
- Produces: `QueryPath = string | StatePath` and `normalizeQueryPath(path: QueryPath): StatePath`.

- [ ] **Step 1: Write failing path tests**

```ts
import { describe, expect, it } from "vitest";
import { normalizeQueryPath } from "../src/query/path";

describe("normalizeQueryPath", () => {
  it.each([
    ["props.item.name", ["props", "item", "name"]],
    ["setup.rows.0.name", ["setup", "rows", 0, "name"]],
    ["rows.01", ["rows", "01"]],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeQueryPath(input)).toEqual(expected);
  });

  it("preserves exact array segments", () => {
    const path = ["state", "key.with.dot", 2] as const;
    expect(normalizeQueryPath([...path])).toEqual(path);
  });

  it.each(["", ".state", "state.", "state..name"])(
    "rejects invalid string path %j",
    (path) => expect(() => normalizeQueryPath(path)).toThrow(TypeError),
  );
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npx vitest run tests/query-path.test.ts`

Expected: FAIL because `../src/query/path` does not exist.

- [ ] **Step 3: Implement exact path normalization**

```ts
import type { StatePath } from "../public-types.js";

export type QueryPath = string | StatePath;

const CANONICAL_INDEX = /^(0|[1-9]\d*)$/;

export function normalizeQueryPath(path: QueryPath): StatePath {
  if (Array.isArray(path)) return [...path];
  if (typeof path !== "string" || path.length === 0)
    throw new TypeError("Query path must be a non-empty string or StatePath");
  const segments = path.split(".");
  if (segments.some((segment) => segment.length === 0))
    throw new TypeError(`Query path contains an empty segment: ${path}`);
  return segments.map((segment) =>
    CANONICAL_INDEX.test(segment) ? Number(segment) : segment,
  );
}
```

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run tests/query-path.test.ts && npm run typecheck`

Expected: query path tests PASS and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/query/path.ts tests/query-path.test.ts
git commit -m "feat: add fluent query path grammar"
```

---

### Task 2: Public query types and immutable builders

**Files:**
- Create: `src/query/types.ts`
- Create: `src/query/plan.ts`
- Create: `src/query/builder.ts`
- Create: `tests/query-builder.test.ts`
- Modify: `src/index.ts`
- Modify: `src/client.ts`

**Interfaces:**
- Consumes: existing public result and option types plus `QueryPath`.
- Produces: `ProbeQueryRoot`, all concrete query interfaces, `QueryFormat`, `QueryRuntime`, `QueryPlan`, and `createProbeQueryRoot(runtime)`.

- [ ] **Step 1: Write failing builder tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { createProbeQueryRoot } from "../src/query/builder";
import type { QueryRuntime } from "../src/query/plan";

function runtimeFixture(): QueryRuntime {
  return {
    run: vi.fn(async (plan) => plan),
    show: vi.fn(async (plan, format) => ({ plan, format })),
  };
}

describe("query builders", () => {
  it("are lazy, immutable, reusable, and not thenable", async () => {
    const runtime = runtimeFixture();
    const root = createProbeQueryRoot(runtime);
    const app = root.app();
    const tree = app.tree();
    const state = app.component("UserList").get("setup.rows");

    expect(runtime.run).not.toHaveBeenCalled();
    expect(Object.isFrozen(root)).toBe(true);
    expect(Object.isFrozen(app)).toBe(true);
    expect("then" in state).toBe(false);

    await tree.run();
    await state.page({ offset: 50, limit: 50 }).show("json");

    expect(runtime.run).toHaveBeenCalledWith({
      kind: "tree",
      app: { kind: "app", selector: { kind: "default" } },
      options: { format: "flat", maxDepth: 5, includeFile: false },
    });
    expect(runtime.show).toHaveBeenCalledOnce();
  });

  it("builds singular, plural, Pinia, and DOM plans", async () => {
    const runtime = runtimeFixture();
    const root = createProbeQueryRoot(runtime);
    await root.app("admin").component("Card").nth(2).dom().run();
    await root.app({ name: "Admin" }).components("Card").run();
    await root.app().pinia("users").get("list.0").run();
    await root.app().fromDOM("#card").get("props.item").run();
    expect(runtime.run).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: Run the builder test and verify failure**

Run: `npx vitest run tests/query-builder.test.ts`

Expected: FAIL because builder, plan, and public query types do not exist.

- [ ] **Step 3: Define the public generics and concrete interfaces**

Create `src/query/types.ts` with these exact foundations and concrete
interfaces for every approved chain:

```ts
import type {
  AppSummary,
  ComponentDOMOptions,
  ComponentDOMResult,
  ComponentFromDOMOptions,
  ComponentFromDOMResult,
  ComponentStateResult,
  ComponentTreeNode,
  ComponentTreeOptions,
  ComponentTreeResult,
  DetailedStateOptions,
  DetailedStateResult,
  PiniaStateResult,
  PiniaStoreSummary,
  PiniaStoresOptions,
  StateReadOptions,
} from "../public-types.js";
import type { QueryPath } from "./path.js";

export type QueryFormat =
  | "markdown" | "json" | "raw" | "table" | "paths" | "mermaid";
export type QueryTable = ReadonlyArray<Record<string, unknown>>;
export type ShownValue<F extends QueryFormat, T> =
  F extends "raw" ? T : F extends "table" ? QueryTable : string;

export interface QueryTerminal<
  T,
  TDefault extends QueryFormat,
  TAllowed extends QueryFormat,
> {
  run(): Promise<T>;
  show(): Promise<ShownValue<TDefault, T>>;
  show<F extends TAllowed>(format: F): Promise<ShownValue<F, T>>;
}

export type QueryTreeOptions = Omit<ComponentTreeOptions, "appId">;
export type QueryStateOptions = Omit<StateReadOptions, "appId" | "expectedRevision">;
export type QueryDetailedOptions = Omit<
  DetailedStateOptions,
  "offset" | "limit" | "expectedRevision"
>;
export interface QueryPageOptions { offset: number; limit: number }
export type QueryPiniaStoresOptions = Omit<PiniaStoresOptions, "appId">;
export type QueryComponentDOMOptions = Omit<
  ComponentDOMOptions,
  "appId" | "expectedRevision"
>;
export type QueryComponentFromDOMOptions = Omit<
  ComponentFromDOMOptions,
  "appId" | "expectedRevision"
>;

export type AppQuerySelector = string | { name: string };

export interface ProbeQueryRoot {
  apps(): AppsQuery;
  app(selector?: AppQuerySelector): AppQuery;
}

export interface AppsQuery
  extends QueryTerminal<AppSummary[], "table", "table" | "json" | "raw"> {}

export interface AppQuery
  extends QueryTerminal<AppSummary, "table", "table" | "json" | "raw"> {
  tree(options?: QueryTreeOptions): TreeQuery;
  component(name: string): ComponentQuery;
  components(name?: string): ComponentsQuery;
  pinia(options?: QueryPiniaStoresOptions): PiniaStoresQuery;
  pinia(storeId: string): PiniaStoreQuery;
  fromDOM(
    target: string | Element,
    options?: QueryComponentFromDOMOptions,
  ): ComponentFromDOMQuery;
}
```

Define the remaining interfaces with these exact overloads and format sets:

```ts
export interface TreeQuery extends QueryTerminal<
  ComponentTreeResult,
  "markdown",
  "markdown" | "mermaid" | "json" | "raw"
> {}

export interface ComponentQuery extends QueryTerminal<
  ComponentTreeNode,
  "markdown",
  "markdown" | "json" | "raw"
> {
  nth(index: number): ComponentQuery;
  get(options?: QueryStateOptions): ComponentStateQuery;
  get(path: QueryPath, options?: QueryDetailedOptions): DetailedStateQuery;
  dom(options?: QueryComponentDOMOptions): ComponentDOMQuery;
}

export interface ComponentsQuery extends QueryTerminal<
  ComponentTreeNode[],
  "markdown",
  "markdown" | "json" | "raw"
> {}

export interface ComponentStateQuery extends QueryTerminal<
  ComponentStateResult,
  "markdown",
  "markdown" | "paths" | "json" | "raw"
> {}

export interface DetailedStateQuery extends QueryTerminal<
  DetailedStateResult,
  "markdown",
  "markdown" | "json" | "raw"
> {
  page(options: QueryPageOptions): DetailedStateQuery;
}

export interface PiniaStoresQuery extends QueryTerminal<
  PiniaStoreSummary[],
  "table",
  "table" | "json" | "raw"
> {}

export interface PiniaStoreQuery extends QueryTerminal<
  PiniaStoreSummary,
  "table",
  "table" | "json" | "raw"
> {
  get(options?: QueryStateOptions): PiniaStateQuery;
  get(path: QueryPath, options?: QueryDetailedOptions): DetailedStateQuery;
}

export interface PiniaStateQuery extends QueryTerminal<
  PiniaStateResult,
  "markdown",
  "markdown" | "paths" | "json" | "raw"
> {}

export interface ComponentDOMQuery extends QueryTerminal<
  ComponentDOMResult,
  "table",
  "table" | "json" | "raw"
> {}

export interface ComponentFromDOMQuery extends QueryTerminal<
  ComponentFromDOMResult,
  "json",
  "json" | "raw"
> {
  get(options?: QueryStateOptions): ComponentStateQuery;
  get(path: QueryPath, options?: QueryDetailedOptions): DetailedStateQuery;
}
```

- [ ] **Step 4: Define internal plans and implement frozen builders**

Create `src/query/plan.ts` with explicit serializable descriptors:

```ts
import type { QueryFormat } from "./types.js";

export type AppSelectorPlan =
  | { readonly kind: "default" }
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "name"; readonly name: string };

export type AppPlan = { readonly kind: "app"; readonly selector: AppSelectorPlan };

export type QueryPlan =
  | { readonly kind: "apps" }
  | AppPlan
  | { readonly kind: "tree"; readonly app: AppPlan; readonly options: object }
  | { readonly kind: "component"; readonly app: AppPlan; readonly name: string; readonly index: number }
  | { readonly kind: "components"; readonly app: AppPlan; readonly name?: string }
  | { readonly kind: "component-state"; readonly component: QueryPlan; readonly options: object }
  | { readonly kind: "detailed-state"; readonly target: QueryPlan; readonly path: readonly (string | number)[]; readonly options: object; readonly page?: { readonly offset: number; readonly limit: number } }
  | { readonly kind: "pinia-stores"; readonly app: AppPlan; readonly options: object }
  | { readonly kind: "pinia-store"; readonly app: AppPlan; readonly storeId: string }
  | { readonly kind: "component-dom"; readonly component: QueryPlan; readonly options: object }
  | { readonly kind: "component-from-dom"; readonly app: AppPlan; readonly target: string | Element; readonly options: object };

export interface QueryRuntime {
  run<T>(plan: QueryPlan): Promise<T>;
  show<T>(plan: QueryPlan, format?: QueryFormat): Promise<T>;
}
```

Implement `createProbeQueryRoot(runtime)` in `src/query/builder.ts` with frozen
plain objects. Clone every options object and every path/page value. Defaults
for `tree()` are `{ format: "flat", maxDepth: 5, includeFile: false }`.
Normalize detailed paths immediately with `normalizeQueryPath()`. Validate
non-empty names/store IDs, non-negative safe `nth`, and non-negative safe page
offset plus positive safe page limit before creating the next plan.

- [ ] **Step 5: Export query declarations and run tests**

Append this to both entry points:

```ts
export type * from "./query/types.js";
```

Run: `npx vitest run tests/query-path.test.ts tests/query-builder.test.ts && npm run typecheck`

Expected: focused tests PASS and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/query/types.ts src/query/plan.ts src/query/builder.ts src/index.ts src/client.ts tests/query-builder.test.ts
git commit -m "feat: add immutable fluent query builders"
```

---

### Task 3: App, tree, and component executor

**Files:**
- Create: `src/query/error.ts`
- Create: `src/query/executor.ts`
- Create: `tests/query-executor.test.ts`

**Interfaces:**
- Consumes: `QueryPlan`, existing facade method signatures, and `ProbeResult`.
- Produces: `ProbeQueryError`, `ProbeQueryOperations`, and `createQueryExecutor(operations).execute(plan)`.

- [ ] **Step 1: Write failing selection and error tests**

Create a typed operations fixture whose methods are `vi.fn()` functions
returning successful envelopes. Cover these exact assertions:

```ts
it("selects active, fallback, id, and first exact-name apps", async () => {
  const operations = operationsFixture();
  const execute = createQueryExecutor(operations).execute;
  await expect(execute(appPlan())).resolves.toMatchObject({ id: "active" });
  await expect(execute(appPlan("admin"))).resolves.toMatchObject({ id: "admin" });
  await expect(execute(appNamePlan("Admin"))).resolves.toMatchObject({ id: "admin" });
});

it("uses one full-depth filtered tree and stable breadth-first nth selection", async () => {
  const operations = operationsFixture();
  const execute = createQueryExecutor(operations).execute;
  await expect(execute(componentPlan("Card", 1))).resolves.toMatchObject({ id: "shallow-2" });
  expect(operations.getComponentTree).toHaveBeenCalledWith({
    appId: "active",
    filter: "Card",
    format: "flat",
    maxDepth: null,
    includeFile: false,
  });
});

it("turns failures into ProbeQueryError with safe context", async () => {
  const operations = operationsFixture();
  vi.mocked(operations.listApps).mockResolvedValue(failure("NOT_READY"));
  await expect(createQueryExecutor(operations).execute({ kind: "apps" }))
    .rejects.toMatchObject({ code: "NOT_READY", step: "list-apps" });
});
```

Add the remaining cases as explicit tests:

```ts
it("falls back to the first app when none is active", async () => {
  const operations = operationsFixture({ active: false });
  await expect(createQueryExecutor(operations).execute(appPlan()))
    .resolves.toMatchObject({ id: "first" });
});

it.each([appPlan("missing"), appNamePlan("Missing")])(
  "throws APP_NOT_FOUND for an absent app selection",
  async (plan) => {
    await expect(createQueryExecutor(operationsFixture()).execute(plan))
      .rejects.toMatchObject({ code: "APP_NOT_FOUND", step: "resolve-app" });
  },
);

it("throws COMPONENT_NOT_FOUND for missing and out-of-range matches", async () => {
  const execute = createQueryExecutor(operationsFixture()).execute;
  await expect(execute(componentPlan("Missing", 0)))
    .rejects.toMatchObject({ code: "COMPONENT_NOT_FOUND" });
  await expect(execute(componentPlan("Card", 99)))
    .rejects.toMatchObject({ code: "COMPONENT_NOT_FOUND" });
});

it("returns plural matches in stable breadth-first order", async () => {
  await expect(
    createQueryExecutor(operationsFixture()).execute(componentsPlan("Card")),
  ).resolves.toMatchObject([
    { id: "shallow-1" },
    { id: "shallow-2" },
    { id: "deep-1" },
  ]);
});

it("forwards explicit tree options and executes fresh on every run", async () => {
  const operations = operationsFixture();
  const executor = createQueryExecutor(operations);
  const plan = treePlan({ format: "nested", maxDepth: 10, includeFile: true });
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
```

- [ ] **Step 2: Run executor tests and verify failure**

Run: `npx vitest run tests/query-executor.test.ts`

Expected: FAIL because error and executor modules do not exist.

- [ ] **Step 3: Implement `ProbeQueryError` and unwrapping**

```ts
export class ProbeQueryError extends Error {
  readonly name = "ProbeQueryError";
  constructor(
    message: string,
    readonly code: ProbeErrorCode,
    readonly meta: ResponseMeta,
    readonly step: string,
    readonly query: string,
  ) {
    super(message);
  }
}

export function unwrapProbeResult<T>(
  result: ProbeResult<T>,
  step: string,
  plan: QueryPlan,
): { data: T; meta: ResponseMeta } {
  if (!result.ok)
    throw new ProbeQueryError(
      result.error.message,
      result.error.code,
      result.meta,
      step,
      describeQueryPlan(plan),
    );
  return { data: result.data, meta: result.meta };
}
```

Add a query-owned error factory using `probe-0`, revision `0`, and a stable
ISO epoch fallback for local selection/validation failures.

- [ ] **Step 4: Implement app/tree/component execution**

Define `ProbeQueryOperations` structurally with all existing facade methods
and formatters but no `query` member. Implement recursive resolution with a
per-execution context and these rules:

```ts
const breadthFirst = (nodes: ComponentTreeNode[]) =>
  nodes
    .map((node, sourceIndex) => ({ node, sourceIndex }))
    .sort((a, b) => a.node.depth - b.node.depth || a.sourceIndex - b.sourceIndex)
    .map(({ node }) => node);
```

- Resolve apps once per app-scoped execution through `listApps()`.
- Never use `listApps().meta.revision` as selected-app revision.
- Explicit `tree()` passes defaults/options plus resolved `appId`.
- Component selection requests flat, `maxDepth: null`, exact filters after the
  facade result, then stable breadth-first ordering.
- Store the tree response revision for later state/DOM steps.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx vitest run tests/query-executor.test.ts && npm run typecheck`

Expected: executor tests PASS and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/query/error.ts src/query/executor.ts tests/query-executor.test.ts
git commit -m "feat: execute fluent app and component queries"
```

---

### Task 4: State, Pinia, DOM, paging, and revision execution

**Files:**
- Modify: `src/query/executor.ts`
- Modify: `tests/query-executor.test.ts`

**Interfaces:**
- Consumes: selection results and revisions from Task 3.
- Produces: execution for every remaining approved plan kind.

- [ ] **Step 1: Add failing state/Pinia/DOM tests**

Add these tests that assert exact facade calls:

```ts
it("forwards component-tree revision to detailed state", async () => {
  const operations = operationsFixture();
  await createQueryExecutor(operations).execute(componentDetailPlan());
  expect(operations.getDetailedState).toHaveBeenCalledWith(
    { kind: "component", componentId: "list", appId: "active" },
    ["setup", "rows"],
    expect.objectContaining({ expectedRevision: 7, offset: 50, limit: 50 }),
  );
});

it("reads exact Pinia state without listing stores", async () => {
  const operations = operationsFixture();
  await createQueryExecutor(operations).execute(piniaStatePlan("users"));
  expect(operations.getPiniaState).toHaveBeenCalledWith("users", {
    appId: "active",
  });
  expect(operations.getPiniaStores).not.toHaveBeenCalled();
});

it("carries DOM-resolved identity and revision into state", async () => {
  const operations = operationsFixture();
  await createQueryExecutor(operations).execute(fromDOMDetailPlan("#card"));
  expect(operations.getDetailedState).toHaveBeenCalledWith(
    { kind: "component", componentId: "card", appId: "active" },
    ["props", "item"],
    expect.objectContaining({ expectedRevision: 9 }),
  );
});
```

Add the remaining execution cases explicitly:

```ts
it("reads full component state and component DOM with tree revision", async () => {
  const operations = operationsFixture();
  const execute = createQueryExecutor(operations).execute;
  await execute(componentStatePlan("List"));
  await execute(componentDOMPlan("Card"));
  expect(operations.getComponentState).toHaveBeenCalledWith("list", {
    appId: "active",
    expectedRevision: 7,
  });
  expect(operations.getComponentDOM).toHaveBeenCalledWith("card", {
    appId: "active",
    expectedRevision: 7,
  });
});

it("lists Pinia stores and selects one exact summary", async () => {
  const operations = operationsFixture();
  const execute = createQueryExecutor(operations).execute;
  await expect(execute(piniaStoresPlan())).resolves.toHaveLength(2);
  await expect(execute(piniaStorePlan("users")))
    .resolves.toMatchObject({ id: "users", appId: "active" });
});

it("reads detailed Pinia state with the normalized path", async () => {
  const operations = operationsFixture();
  await createQueryExecutor(operations).execute(piniaDetailPlan("users"));
  expect(operations.getDetailedState).toHaveBeenCalledWith(
    { kind: "pinia", storeId: "users", appId: "active" },
    ["list", 0, "name"],
    {},
  );
});

it("returns DOM identity when fromDOM is terminal", async () => {
  await expect(
    createQueryExecutor(operationsFixture()).execute(fromDOMPlan("#card")),
  ).resolves.toEqual({
    appId: "active",
    componentId: "card",
    name: "UserCard",
  });
});

it("preserves STALE_REVISION from a downstream facade read", async () => {
  const operations = operationsFixture();
  vi.mocked(operations.getComponentState).mockResolvedValue(
    failure("STALE_REVISION", 8),
  );
  await expect(
    createQueryExecutor(operations).execute(componentStatePlan("List")),
  ).rejects.toMatchObject({ code: "STALE_REVISION", meta: { revision: 8 } });
});

it.each([
  { offset: -1, limit: 50 },
  { offset: 0, limit: 0 },
  { offset: 0.5, limit: 50 },
])("rejects invalid page options before execution", async (page) => {
  expect(() => detailedBuilderFixture().page(page)).toThrow(TypeError);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run tests/query-executor.test.ts`

Expected: new state, Pinia, DOM, and paging cases FAIL.

- [ ] **Step 3: Implement all remaining plan kinds**

Use recursive target resolvers that return both data and internal context.
Build options by spreading only user-owned budget/metadata fields and then
adding executor-owned fields:

```ts
const detailedOptions = {
  ...plan.options,
  ...(context.revision === undefined
    ? {}
    : { expectedRevision: context.revision }),
  ...(plan.page === undefined ? {} : plan.page),
};
```

Component full state calls `getComponentState(componentId, { ...options,
appId, expectedRevision })`. Pinia full state calls `getPiniaState(storeId, {
...options, appId })` directly. `fromDOM` passes resolved `appId`, captures the
returned identity and revision, and then continues through component state or
detailed state. All facade failures pass through `unwrapProbeResult()`.

- [ ] **Step 4: Run focused and regression tests**

Run: `npx vitest run tests/query-executor.test.ts tests/facade-revision.test.ts tests/facade-dom.test.ts`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/query/executor.ts tests/query-executor.test.ts
git commit -m "feat: execute fluent state pinia and DOM queries"
```

---

### Task 5: Query renderer and terminal display

**Files:**
- Create: `src/query/renderer.ts`
- Create: `tests/query-renderer.test.ts`
- Create: `src/query/index.ts`
- Modify: `src/query/plan.ts`

**Interfaces:**
- Consumes: executor output, plan kind, existing `ProbeFormatters`, and global console.
- Produces: `renderQueryResult()`, `showQueryResult()`, and `createProbeQueryAPI(operations)`.

- [ ] **Step 1: Write failing renderer tests**

```ts
it("uses type-specific defaults and returns the printed value", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const table = vi.spyOn(console, "table").mockImplementation(() => {});
  const dir = vi.spyOn(console, "dir").mockImplementation(() => {});

  const appRows = showQueryResult(appsPlan, apps, undefined, formatters);
  expect(table).toHaveBeenCalledWith(appRows);

  const markdown = showQueryResult(treePlan, tree, undefined, formatters);
  expect(markdown).toBe(formatters.toMarkdown(tree));
  expect(log).toHaveBeenCalledWith(markdown);

  const raw = showQueryResult(treePlan, tree, "raw", formatters);
  expect(raw).toBe(tree);
  expect(dir).toHaveBeenCalledWith(tree);
});

it("rejects unsupported format before logging", () => {
  expect(() => showQueryResult(appsPlan, apps, "mermaid", formatters))
    .toThrowError(expect.objectContaining({ code: "INVALID_OPTIONS" }));
  expect(console.log).not.toHaveBeenCalled();
});
```

Add cases for tree Mermaid, state Markdown/paths, detailed value plus compact
page information, DOM table rows, JSON via `toCleanJson`, raw identity, and no
console calls after executor rejection.

- [ ] **Step 2: Run renderer tests and verify failure**

Run: `npx vitest run tests/query-renderer.test.ts`

Expected: FAIL because renderer and query composition modules do not exist.

- [ ] **Step 3: Implement allowed formats and rendering**

Create a plan-kind format policy with exact defaults from the design. Reuse:

```ts
formatters.toMarkdown(treeOrState);
formatters.treeToMermaid(tree);
formatters.stateToPaths(state);
formatters.toCleanJson(data);
```

Normalize table data to arrays of plain row records. For DOM results, use
locator fields (`selector`, `tag`, `connected`, text preview, and rectangle)
as rows so `console.table` receives structured data. For detailed Markdown,
render the value compactly and append one page line containing `offset`,
`limit`, `returned`, `total`, and `nextOffset` when present.

- [ ] **Step 4: Compose runtime and builders**

Implement:

```ts
export function createProbeQueryAPI(
  operations: ProbeQueryOperations,
): ProbeQueryRoot {
  const executor = createQueryExecutor(operations);
  const runtime: QueryRuntime = {
    run: (plan) => executor.execute(plan),
    show: async (plan, format) =>
      showQueryResult(
        plan,
        await executor.execute(plan),
        format,
        operations.formatters,
      ),
  };
  return createProbeQueryRoot(runtime);
}
```

Ensure renderer failures become `ProbeQueryError` with step `render`, and no
partial output occurs before validation/formatting completes.

- [ ] **Step 5: Run query tests and typecheck**

Run: `npx vitest run tests/query-path.test.ts tests/query-builder.test.ts tests/query-executor.test.ts tests/query-renderer.test.ts && npm run typecheck`

Expected: all query tests PASS and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/query/renderer.ts src/query/index.ts src/query/plan.ts tests/query-renderer.test.ts
git commit -m "feat: render and show fluent query results"
```

---

### Task 6: Facade, browser, and declaration integration

**Files:**
- Modify: `src/public-types.ts`
- Modify: `src/core/facade.ts`
- Modify: `src/index.ts`
- Modify: `src/client.ts`
- Modify: `tests/client.test.ts`
- Modify: `tests/types-dist/consumer.ts`

**Interfaces:**
- Consumes: `createProbeQueryAPI()` and `ProbeQueryRoot`.
- Produces: one installed/frozen `ProbeAPI` with readonly `query` and package-level query/error exports.

- [ ] **Step 1: Write failing browser and type-consumer assertions**

Add to `tests/client.test.ts`:

```ts
expect(first!.query).toBeDefined();
expect(Object.isFrozen(first!.query)).toBe(true);
expect("then" in first!.query.app().tree()).toBe(false);
```

Add valid declaration usage to `tests/types-dist/consumer.ts`:

```ts
const queryTree: Promise<string> = api.query.app().tree().show("markdown");
const queryPage = api.query
  .app()
  .component("UserList")
  .get("setup.rows")
  .page({ offset: 0, limit: 50 })
  .run();
void queryTree;
void queryPage;

// @ts-expect-error apps do not support Mermaid.
void api.query.apps().show("mermaid");
// @ts-expect-error full state reads are not pageable.
void api.query.app().component("UserList").get().page({ offset: 0, limit: 50 });
// @ts-expect-error query options cannot override the selected app.
void api.query.app().tree({ appId: "other" });
```

- [ ] **Step 2: Run integration/type tests and verify failure**

Run: `npx vitest run tests/client.test.ts && npm run test:types-dist`

Expected: FAIL because `ProbeAPI.query` is not integrated.

- [ ] **Step 3: Attach one query namespace to the facade**

In `src/public-types.ts`, import `ProbeQueryRoot` as a type and add:

```ts
readonly query: ProbeQueryRoot;
```

In `createProbeAPI()`, assign the existing object literal to a `core` constant,
then return:

```ts
return {
  ...core,
  query: createProbeQueryAPI(core),
};
```

The structural `ProbeQueryOperations` contract must allow `core` without a
circular `ProbeAPI` assertion. `installProbeAPI()` continues freezing the
combined object; the query factory freezes its root and every generated query.

Export `ProbeQueryError` as a value from `src/index.ts` and `src/client.ts`, and
export all query public types from both entry points.

- [ ] **Step 4: Run integration, distribution, and regression tests**

Run: `npx vitest run tests/client.test.ts tests/facade.test.ts tests/facade-validation.test.ts && npm run test:types-dist && npm run test:dist`

Expected: all commands PASS.

- [ ] **Step 5: Commit**

```bash
git add src/public-types.ts src/core/facade.ts src/index.ts src/client.ts tests/client.test.ts tests/types-dist/consumer.ts
git commit -m "feat: expose fluent query API in browser"
```

---

### Task 7: Documentation and full verification

**Files:**
- Modify: `README.md`
- Modify: `README_ru.md`
- Modify: `skills/vue-probe/SKILL.md`

**Interfaces:**
- Consumes: completed public fluent API.
- Produces: parallel explicit/fluent documentation for users and agents.

- [ ] **Step 1: Add fluent README examples in both languages**

Add a `Fluent query API` / `Fluent query API` section near the DevTools console
introduction. Keep existing explicit examples and include these executable
equivalents:

```js
const { query: $pq } = window.VUE_PROBE;

await $pq.apps().show();
await $pq.app().tree().show("markdown");
await $pq.app().component("UserList").get("props.item").show("markdown");
await $pq.app().component("UserCard").dom().show("table");
await $pq.app().fromDOM("#user-card").get("props.item").show();
await $pq
  .app()
  .component("UserList")
  .get("setup.rows")
  .page({ offset: 50, limit: 50 })
  .show("json");
await $pq.app().pinia("users").get("list").show("markdown");
```

Document active-first app selection, first-match/nth component selection,
string versus array paths, explicit terminal execution, throwing query errors,
and the fact that the original envelope API remains available.

- [ ] **Step 2: Update the bundled agent skill**

Replace routine verbose workflow reads with fluent chains while keeping one
explicit envelope example for callers that need `meta`, failure envelopes, or
manual revision control. State that `run()` returns complete unwrapped facade
data and `show()` prints/returns formatted output.

- [ ] **Step 3: Run documentation contract checks**

Run:

```bash
rg -n 'VUE_PROBE\.query|const \{ query: \$pq \}|\.page\(' README.md README_ru.md skills/vue-probe/SKILL.md
```

Expected: all three files contain the fluent namespace and the two READMEs
contain the paging example.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run test:dist
npm run test:types-dist
```

Expected: every command exits 0; Vitest reports no failed test files or tests.

- [ ] **Step 5: Review the final diff against acceptance criteria**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~6..HEAD
```

Expected: no whitespace errors; only query implementation, integration,
tests, and approved documentation are changed.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md README_ru.md skills/vue-probe/SKILL.md
git commit -m "docs: document fluent query workflows"
```
