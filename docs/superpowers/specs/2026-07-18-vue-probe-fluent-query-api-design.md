# Vue Probe Fluent Query API Design

## Status

Approved for implementation on 2026-07-18.

## Goal

Add a concise, Go-Rod-inspired fluent query layer at
`window.VUE_PROBE.query`. The layer is additive: the existing `ProbeAPI`
methods, result envelopes, formatters, validation, and data-source behavior
remain available and unchanged.

The fluent API targets DevTools users, LLM agents, and tests that benefit from
short, discoverable one-line reads without repeated app resolution, tree
searches, envelope checks, revision forwarding, and formatter calls.

```js
const { query: $pq } = window.VUE_PROBE;

await $pq.app().component("UserList").get("props.item").show("markdown");
await $pq.app().pinia("users").get("list.0.name").show();
```

## Non-goals

- Replacing or deprecating the existing `ProbeAPI`.
- Exposing raw Vue, Pinia, or DevTools objects.
- Bypassing serialization budgets, hard limits, or revision checks.
- Adding state mutation or browser automation.
- Making query objects thenable.
- Automatically loading every page of a truncated value.
- Moving query logic into `ProbeDataSource`.

## Design principles

1. Query construction is lazy. Only `run()` and `show()` perform work.
2. Query objects are immutable and reusable. Every builder call returns a new
   query object.
3. The executor calls only the existing `ProbeAPI`; it never accesses
   `ProbeDataSource`, Vue DevTools, Pinia, or component internals directly.
4. Singular selectors use deterministic first-match semantics. Plural
   selectors return all matches.
5. Successful result envelopes are unwrapped by terminal operations. Failure
   envelopes become typed exceptions.
6. Snapshot revisions are forwarded between compatible app-specific steps.
7. Runtime validation remains mandatory even when TypeScript rejects an
   invalid chain or format.

## Architecture

The feature has three layers.

### Query DSL

Typed immutable query objects build a small declarative query plan. Builder
methods do not inspect the page and do not retain execution results.

Example plan:

```text
app(active-first) -> component(UserList, nth=0) -> get(props.item)
```

The plan uses explicit discriminated steps rather than functions or closures,
so it can be validated, rendered safely in errors, and unit-tested.

### Query executor

One executor interprets the plan through the existing `ProbeAPI`. During one
execution it carries an internal context containing, when available:

- selected `appId`;
- selected `ComponentTreeNode` or Pinia `storeId`;
- latest app-specific `revision`;
- resolved `StateTarget`;
- normalized `StatePath`.

The context is local to one `run()` or `show()` call. Re-running the same query
performs a fresh read.

### Terminal and rendering layer

`run()` executes and unwraps data without logging. `show(format?)` executes the
same plan, formats the unwrapped data, prints it, and returns the value passed
to the console.

The browser-facing API extends the unchanged core `ProbeAPI` producer contract
with one readonly member:

```ts
export interface ProbeBrowserAPI extends ProbeAPI {
  readonly query: ProbeQueryRoot;
}
```

Keeping `ProbeAPI` as the original envelope-only surface preserves source
compatibility for downstream adapters and mocks. `window.VUE_PROBE` and
`installProbeAPI()` use `ProbeBrowserAPI`, so browser consumers still get
non-optional fluent-query autocomplete.

The facade creates its existing API methods first and passes that stable API
surface to the query factory. The query layer must not create a second facade
or data source.

## Public query contract

The exact implementation may use classes or factory objects, but emitted
declarations must expose focused interfaces so autocomplete only suggests
valid next steps and formats.

App identity and snapshot fields belong to the chain, not to individual
operations. Query-specific option types therefore omit context-owned fields:

```ts
type QueryTreeOptions = Omit<ComponentTreeOptions, "appId">;
type QueryStateOptions = Omit<
  StateReadOptions,
  "appId" | "expectedRevision"
>;
type QueryDetailedOptions = Omit<
  DetailedStateOptions,
  "offset" | "limit" | "expectedRevision"
>;
type QueryPiniaStoresOptions = Omit<PiniaStoresOptions, "appId">;
type QueryComponentDOMOptions = Omit<
  ComponentDOMOptions,
  "appId" | "expectedRevision"
>;
type QueryComponentFromDOMOptions = Omit<
  ComponentFromDOMOptions,
  "appId" | "expectedRevision"
>;
```

The executor supplies omitted fields from its resolved context. Users cannot
contradict an earlier `app(...)` selection or disable automatic revision
forwarding through a later options object.

### Root and applications

```ts
export interface ProbeQueryRoot {
  apps(): AppsQuery;
  app(selector?: AppQuerySelector): AppQuery;
}

export type AppQuerySelector = string | { name: string };
```

```js
$pq.apps();
$pq.app();
$pq.app("app-id");
$pq.app({ name: "Admin" });
```

Selection rules:

- `app()` selects the active app; when none is active, it selects the first
  app returned by `listApps()`.
- A string selects an exact `appId`.
- `{ name }` selects the first exact name match in list order.
- A missing selection throws `APP_NOT_FOUND`.
- `apps().run()` returns the complete `AppSummary[]`.
- `app(...).run()` returns the selected `AppSummary`.

### Trees and component selection

```js
$pq.app().tree();
$pq.app().tree({ format: "nested", maxDepth: 10 });

$pq.app().component("UserCard");
$pq.app().component("UserCard").nth(2);
$pq.app().components();
$pq.app().components("UserCard");
```

`tree()` applies query-layer defaults before calling the facade:

```ts
{ format: "flat", maxDepth: 5, includeFile: false }
```

Explicit options override these defaults and retain the existing tree-option
surface except for `appId`, which is owned by `app(...)`.

`component(name)` performs one full-depth flat tree request with `filter:
name`, keeps exact `node.name === name` matches, orders them deterministically
by ascending depth while preserving source order within a depth, and selects
index zero. It does not perform iterative `maxDepth` requests because the
current facade applies `maxDepth` after the data source has already obtained
the tree.

`nth(index)` returns a new component query with a zero-based non-negative
index. It does not execute. An out-of-range index throws
`COMPONENT_NOT_FOUND`.

`components()` returns every component in deterministic breadth-first order.
`components(name)` additionally applies the same filtered exact-name match.

`component(...).run()` returns one `ComponentTreeNode`.
`components(...).run()` returns `ComponentTreeNode[]`.

### Component state

```js
$pq.app().component("UserList").get();
$pq.app().component("UserList").get("props.item");
$pq.app().component("UserList").get(["props", "key.with.dot"]);
$pq.app().component("UserList").get("setup.rows").page({
  offset: 50,
  limit: 50,
});
```

- `get()` calls `getComponentState()` and returns the complete unwrapped
  `ComponentStateResult`.
- `get(path)` calls `getDetailedState()` and returns the complete unwrapped
  `DetailedStateResult`, including `target`, normalized `path`, `value`, and
  optional `page`.
- Existing serialization and metadata-budget options remain accepted on state
  reads through `QueryStateOptions` and `QueryDetailedOptions`. `appId`,
  `expectedRevision`, `offset`, and `limit` remain owned by the chain and
  executor as described above.
- `page({ offset, limit })` is available only after a non-empty detailed path.
  It returns a new query and maps to `DetailedStateOptions`.
- There is no automatic `all()` terminal in this version.

### Path grammar

`get()` accepts `string | StatePath`.

```js
.get("props.item.name")          // ["props", "item", "name"]
.get("setup.rows.0.name")       // ["setup", "rows", 0, "name"]
.get(["state", "key.with.dot"]) // passed unchanged
```

String rules:

- split on `.`;
- reject an empty string or empty segment;
- convert a canonical non-negative integer segment to a number;
- leave other segments as strings;
- use an array when a literal key contains a dot or is numeric-looking.

The normalized array is still validated by the existing detailed-state path
validation.

### Pinia

```js
$pq.app().pinia();
$pq.app().pinia("users");
$pq.app().pinia("users").get();
$pq.app().pinia("users").get("list.0.name");
```

- `pinia()` calls `getPiniaStores()` and returns `PiniaStoreSummary[]`.
- `pinia(storeId).run()` returns the exact matching `PiniaStoreSummary`. The
  executor uses `getPiniaStores()` for this selection query.
- `pinia(storeId).get()` calls `getPiniaState()` directly and returns the
  complete `PiniaStateResult`; it does not make a preliminary store-list call.
- `pinia(storeId).get(path)` calls `getDetailedState()` with a Pinia target and
  returns `DetailedStateResult`.
- Missing stores preserve the facade's `STORE_NOT_FOUND` failure.

### DOM

```js
$pq.app().component("UserCard").dom();
$pq.app().fromDOM("#user-card");
$pq.app().fromDOM(document.querySelector("#user-card"));
$pq.app().fromDOM("#user-card").get("props.item");
```

- `component(...).dom()` calls `getComponentDOM()` and returns
  `ComponentDOMResult`.
- `fromDOM(target)` calls `getComponentFromDOM()` and returns
  `ComponentFromDOMResult`.
- `fromDOM(target).get()` continues with `getComponentState()` using the
  resolved `appId` and `componentId`.
- `fromDOM(target).get(path)` continues with `getDetailedState()`.
- CSS-selector and `Element` validation remains owned by the existing facade.

### Terminal methods

Every executable query exposes:

```ts
run(): Promise<TData>;
show(): Promise<TDefaultShown>;
show<TFormat extends AllowedFormat>(format: TFormat): Promise<Shown<TFormat>>;
```

Query objects have no `then`, `catch`, or `finally`. Awaiting a query object
does not execute it.

## Formats

Formats are type-specific. TypeScript should not offer formats that have no
meaning for a query, and runtime validation must reject them with
`INVALID_OPTIONS`.

| Query result | Default | Explicit formats |
| --- | --- | --- |
| Apps/app summaries | `table` | `table`, `json`, `raw` |
| Component tree | `markdown` | `markdown`, `mermaid`, `json`, `raw` |
| Component node(s) | `markdown` | `markdown`, `json`, `raw` |
| Component/Pinia state | `markdown` | `markdown`, `paths`, `json`, `raw` |
| Detailed value | `markdown` | `markdown`, `json`, `raw` |
| Pinia store summary/summaries | `table` | `table`, `json`, `raw` |
| DOM roots | `table` | `table`, `json`, `raw` |
| Component from DOM | `json` | `json`, `raw` |

Console and return behavior:

- `markdown`, `json`, `paths`, and `mermaid`: pass a string to `console.log`
  and return the same string.
- `table`: pass normalized row objects to `console.table` and return the same
  array.
- `raw`: pass unwrapped data to `console.dir` and return the same data.

Existing public formatters are reused where their current types apply. A
query-local renderer handles app summaries, selected component nodes,
detailed values, and component identities. This feature does not expand the
public `ProbeFormatters` interface.

For wrapper results, formatting targets the useful payload while `run()`
retains the complete result:

- `ComponentStateResult` formats `state`;
- `PiniaStateResult` formats its state/getters/custom-property sections;
- `DetailedStateResult` formats `value` and includes compact page information
  when paging metadata is present;
- `ComponentDOMResult` formats `roots`.

## Execution and revision flow

### Component detailed-state example

```text
listApps
-> select and retain appId
-> getComponentTree({ appId, filter, format: "flat", maxDepth: null })
-> exact-name filter and stable breadth-first selection
-> retain componentId and tree revision
-> getDetailedState(target, path, { expectedRevision, offset, limit })
-> unwrap data
```

### DOM-to-state example

```text
listApps
-> select and retain appId
-> getComponentFromDOM(target, { appId })
-> retain componentId and returned revision
-> getDetailedState(target, path, { expectedRevision })
-> unwrap data
```

### Revision rules

- The executor resolves and retains one `appId` at the beginning of an
  app-scoped execution and passes it explicitly thereafter.
- `listApps().meta.revision` is not treated as selected-app revision because it
  can describe the active app on a multi-app page.
- Revisions from app-specific operations are forwarded through
  `expectedRevision` whenever the next facade method accepts it.
- A changed snapshot produces `STALE_REVISION`; the executor does not retry or
  silently mix revisions.
- Direct exact Pinia reads may call `getPiniaState()` without a preliminary
  app-specific revision. The facade captures and verifies its own snapshot.

## Error model

```ts
export class ProbeQueryError extends Error {
  readonly code: ProbeErrorCode;
  readonly meta: ResponseMeta;
  readonly step: ProbeQueryStepName;
  readonly query: string;
}
```

Every facade `ProbeFailure` becomes `ProbeQueryError` with the original code,
message, and metadata. Query-owned failures use the closest existing code:

- missing app selection: `APP_NOT_FOUND`;
- missing component or out-of-range `nth`: `COMPONENT_NOT_FOUND`;
- invalid path, page options, selector shape, or format: `INVALID_OPTIONS`;
- path absent in inspected state: facade `PATH_NOT_FOUND`;
- changed snapshot: facade `STALE_REVISION`.

`step` identifies the failing operation, such as `resolve-app`,
`find-component`, `read-state`, or `render`. `query` is a safe textual plan;
DOM elements are represented by a label rather than serialized. `show()` does
not log partial output when execution or formatting fails.

The original `window.VUE_PROBE` methods continue returning failure envelopes
and never adopt throwing convenience semantics.

## Integration

- `installProbeAPI()` continues to install one `ProbeAPI` object. Its ownership
  and uninstall checks remain unchanged.
- `window.VUE_PROBE.query` is readonly and installed with the facade.
- Reinstalling over an equal/newer compatible API follows the existing client
  behavior; no separate global is introduced.
- Public types are exported from the package declarations so TypeScript users
  can name query interfaces and `ProbeQueryError`.
- The browser build remains dependency-free beyond current dependencies.

Suggested internal modules:

```text
src/query/types.ts       public query interfaces and plan types
src/query/path.ts        dot-path normalization
src/query/builder.ts     immutable typed builders
src/query/executor.ts    plan execution through ProbeAPI
src/query/renderer.ts    type-specific show formatting
src/query/error.ts       ProbeQueryError and safe plan rendering
```

Exact file boundaries may be adjusted during planning, but the builder,
executor, rendering, and error responsibilities must remain separable.

## Documentation examples

The README and agent skill keep the existing explicit API examples and add a
parallel fluent section. Existing examples are not removed because the new
layer is optional.

Equivalent concise forms include:

```js
await $pq.apps().show();

await $pq.app().tree().show("markdown");

await $pq
  .app()
  .component("UserList")
  .get("props.item")
  .show("markdown");

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

Both `README.md` and `README_ru.md` must document the same fluent contract.
The bundled `skills/vue-probe/SKILL.md` should prefer fluent examples for
routine reads and retain the explicit API for envelope-sensitive workflows.

## Testing

### Pure unit tests

- Dot-path parsing, numeric segments, empty segments, and literal dotted keys.
- Immutable builder behavior and safe reuse of a base query.
- `nth()` validation and zero-based selection.
- Stable breadth-first ordering.
- Allowed/default formats per result type.
- Safe plan rendering without serializing DOM elements.

### Executor contract tests

Use a stub `ProbeAPI` to assert exact method calls and options for:

- active, fallback-first, ID, and name app selection;
- apps and tree reads with query defaults;
- component exact matching, plural matching, and `nth()`;
- component state and detailed paths;
- page offset/limit forwarding;
- Pinia list, exact store, full state, and detailed state;
- component DOM and DOM-to-component-to-state;
- app-specific revision forwarding;
- no use of `listApps().meta.revision` as an explicit-app revision;
- direct Pinia state reads without unnecessary store listing;
- fresh execution on repeated `run()` calls.

### Error tests

- Every existing failure code is preserved in `ProbeQueryError`.
- Query-owned not-found and invalid-option failures use the specified codes.
- Errors include `step`, safe `query`, and original `meta`.
- `show()` emits no console call after a failed execution or renderer.

### Renderer tests

- Default formats and explicit supported formats.
- Console method selection and identity of returned printed values.
- Runtime rejection of unsupported format/query combinations.
- Detailed values include compact page information.
- Existing public formatters are called where applicable.

### Integration and regression tests

- `installProbeAPI()` exposes `query` and uninstall ownership still works.
- Existing facade, validation, revision, formatter, DOM, Pinia, JSON-contract,
  build, and type-distribution tests remain green.
- Type fixtures verify valid chains and expected compile failures for invalid
  chaining, `page()` without a path, unsupported formats, and query
  thenability.

## Acceptance criteria

1. Every README scenario has an equivalent fluent one-liner or short chain.
2. The old public API is source- and behavior-compatible.
3. Query construction performs no runtime inspection.
4. Only `run()` and `show()` execute a plan.
5. Singular selection, path parsing, revision forwarding, formatting, and
   typed errors follow this specification.
6. No automatic unbounded pagination is introduced.
7. Tests cover builders, executor calls, errors, renderers, browser
   installation, and emitted TypeScript declarations.
8. Build, typecheck, unit tests, distribution smoke tests, and type-distribution
   tests pass.
