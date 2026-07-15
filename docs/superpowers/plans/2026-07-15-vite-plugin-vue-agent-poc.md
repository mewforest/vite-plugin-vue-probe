# vite-plugin-vue-agent PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dev-only Vite plugin that publishes the read-only, JSON-safe `window.AGENT_API` specified in `outputs/vite-plugin-vue-agent-api-spec.md`.

**Architecture:** Keep all `@vue/devtools-kit` values behind `DevtoolsDataSource`. Normalize inspector payloads into package-owned raw DTOs, serialize them with LLM budgets, then expose them through an exception-safe facade. Inject only a virtual client module during `vite serve`.

**Tech Stack:** TypeScript 5.9, Vite 8.1.4, Vitest 4.1.6, jsdom, `@vue/devtools-kit` 8.1.5, `tsc` library build.

## Global Constraints

- `window.AGENT_API` exists only in `vite serve`; build output must not contain it.
- Public results are JSON-safe `AgentResult<T>` values and never expose Vue/DevTools/DOM objects.
- v1 is read-only: no state editing, action invocation, event subscriptions, or timeline API.
- Initial defaults: depth 2, 25 entries, 500 string chars. Detail defaults: depth 3, page 50. Hard entry/page limit: 200.
- State paths are `Array<string | number>` and reads are live with `revision`, `observedAt`, and optional `expectedRevision`.
- Every behavior change follows RED → GREEN → REFACTOR and is committed with author `mew.forest <mew.forest@gmail.com>`.

---

### Task 1: Package, public contract, and budgeted serializer

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`
- Create: `src/public-types.ts`, `src/core/serializer.ts`, `src/core/path.ts`
- Test: `tests/serializer.test.ts`, `tests/path.test.ts`, `tests/public-types.test-d.ts`

**Interfaces:**
- Produces `AgentValue`, `AgentResult<T>`, all public API types from the specification.
- Produces `serializeAgentValue(value, options): AgentValue` and internal `resolveDetailedValue(root, path, options): ResolvedDetailedValue`; Task 3's facade attaches `StateTarget` to form the public `DetailedStateResult`.

- [x] Write serializer tests for primitives, special values, arrays/objects/strings over budget, cycles, Map/Set, errors, offsets, hard limit, and keys containing dots/slashes.
- [x] Run `npm test -- tests/serializer.test.ts tests/path.test.ts`; confirm failure because modules do not exist.
- [x] Copy the specification's TypeScript declarations into `src/public-types.ts`; implement serializer/path resolution minimally.
- [x] Run focused tests and `npm run typecheck`; confirm zero failures.
- [x] Commit `feat: add agent value serialization contract`.

### Task 2: Inspector normalization and DevTools data source

**Files:**
- Create: `src/core/normalizer.ts`, `src/data-source/types.ts`, `src/data-source/devtools.ts`
- Test: `tests/normalizer.test.ts`, `tests/devtools-data-source.test.ts`

**Interfaces:**
- Consumes public state section/store types from Task 1.
- Produces `AgentDataSource` with app, component tree/state, Pinia tree/state, revision, and component-root access methods.
- Produces `normalizeComponentState(payload)` and `normalizePiniaState(payload)` package-owned DTOs.

- [x] Write failing tests using plain inspector-shaped fixtures; require Pinia component sections to become store references and metadata to be optional.
- [x] Write failing data-source tests with a fake DevTools bridge for app selection, inspector IDs `components`/`pinia`, revision increments, and not-ready/not-found errors.
- [x] Implement the normalizer and dependency-injected `DevtoolsDataSource`; keep the real kit bridge in one factory.
- [x] Run focused tests, full tests, and typecheck.
- [x] Commit `feat: adapt Vue DevTools inspector data`.

### Task 3: Agent facade and DOM locators

**Files:**
- Create: `src/core/dom.ts`, `src/core/facade.ts`, `src/client.ts`
- Test: `tests/dom.test.ts`, `tests/facade.test.ts`, `tests/client.test.ts`

**Interfaces:**
- Consumes `AgentDataSource`, normalizer, serializer, and path resolver.
- Produces `createAgentAPI(dataSource): AgentAPI`, `installAgentAPI()`, and JSON-only `DOMNodeLocator[]`.

- [x] Write failing facade tests for every public method, success/error envelopes, request metadata, expected revisions, multi-app selection, flat/nested trees, and `JSON.stringify` safety.
- [x] Write failing jsdom tests for fragments/multi-root elements, selector uniqueness, detached roots, rects, and 120-character text previews.
- [x] Implement DOM locator generation and the exception-safe facade; freeze the installed API and make installation idempotent.
- [x] Run focused tests, full tests, and typecheck.
- [x] Commit `feat: expose read-only agent API facade`.

### Task 4: Vite plugin, build, and end-to-end contract

**Files:**
- Create: `src/index.ts`, `tests/vite-plugin.test.ts`, `README.md`
- Modify: `package.json`, `tsconfig.build.json`

**Interfaces:**
- Produces default `vueAgent(options?): Plugin` and package subpath `vite-plugin-vue-agent/client`.
- Virtual ID is `virtual:vite-plugin-vue-agent/client`; loaded module calls `installAgentAPI()`.

- [x] Write failing Vite plugin tests for `apply: 'serve'`, `enforce: 'pre'`, virtual resolution/loading, pre-head script injection, and no injection during build.
- [x] Implement plugin hooks with `transformIndexHtml`, `resolveId`, and `load`.
- [x] Add package exports, README usage, API safety warning, and LLM call sequence.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`, then scan `dist` and a production fixture for accidental `AGENT_API` injection.
- [x] Commit `feat: inject Vue agent API in Vite dev server`.

## Final Verification

- [x] Run `npm test -- --run` and report exact test count.
- [x] Run `npm run typecheck` and `npm run build`.
- [x] Verify `git status --short` is clean and all commits use the requested author.
- [x] Perform an independent spec/code review against `outputs/vite-plugin-vue-agent-api-spec.md`.
