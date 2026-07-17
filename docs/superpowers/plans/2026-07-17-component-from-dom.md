# Component from DOM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `$probe.getComponentFromDOM(selectorOrElement, options)` and return the owning Vue component as a JSON-safe `{ appId, componentId, name }` identity.

**Architecture:** Validate the dual-form target at the public boundary, resolve selectors in the existing DOM core, and perform ownership lookup inside the DevTools bridge through `__vueParentComponent`. Verify instance identity against the selected app's `instanceMap`; never expose the raw Vue instance.

**Tech Stack:** TypeScript 5.9, Vue 3.5, `@vue/devtools-kit` 8.1.5, Vitest 4.1, jsdom 27.

## Global Constraints

- Accept both `string` CSS selectors and `Element` targets.
- Return only JSON-safe `appId`, `componentId`, and `name` data in the standard `ProbeResult` envelope.
- Validate an explicit `appId` by identity against that app's `instanceMap`.
- Use `INVALID_OPTIONS`, `NOT_READY`, `COMPONENT_NOT_FOUND`, `APP_NOT_FOUND`, and `STALE_REVISION` consistently with the existing contract.
- Add `componentFromDOM: true` and bump the public API from `0.3.0` to `0.4.0`.
- Do not return `ComponentInternalInstance`, start the interactive picker, search across explicit app boundaries, or add XPath/list lookup.
- Add no production dependency.

## File Structure

- `src/public-types.ts`: public options, result, capability, and `ProbeAPI` declarations.
- `src/core/validation.ts`: safe validation of selector-or-Element targets and plain options.
- `src/core/dom.ts`: selector resolution and stable DOM-related contract errors.
- `src/core/facade.ts`: snapshot/revision orchestration and response envelope.
- `src/data-source/types.ts`: JSON-safe internal component identity boundary.
- `src/data-source/devtools.ts`: Vue owner lookup, app identity verification, and safe display-name fallback.
- `tests/facade-dom.test.ts`: public success/error/revision behavior in jsdom.
- `tests/dom-target.test.ts`: selector resolution when a DOM is unavailable.
- `tests/devtools-data-source.test.ts`: bridge/data-source ownership and app-isolation behavior.
- `tests/facade-validation.test.ts`: hostile and invalid target validation.
- `tests/facade.test.ts`, `tests/json-contract.test.ts`, `tests/types-dist/consumer.ts`: version, capability, wire-safety, and distributed declarations.
- Existing data-source fixtures in `tests/*.test.ts`: add the new required method without changing unrelated behavior.
- `README.md`, `README_ru.md`: API 0.4.0 references and DOM-to-component examples.

---

### Task 1: Public facade contract and DOM target resolution

**Files:**
- Modify: `tests/facade-dom.test.ts`
- Modify: `tests/facade-validation.test.ts`
- Create: `tests/dom-target.test.ts`
- Modify: `src/public-types.ts`
- Modify: `src/core/validation.ts`
- Modify: `src/core/dom.ts`
- Modify: `src/core/facade.ts`
- Modify: `src/data-source/types.ts`

**Interfaces:**
- Produces: `ComponentFromDOMOptions`, `ComponentFromDOMResult`, `ProbeAPI.getComponentFromDOM(target, options)`.
- Produces: `RawComponentIdentity { componentId: string; name: string }` and `ProbeDataSource.getComponentFromElement(appId, element)`.
- Produces: `validateComponentFromDOM(target, options)` and `resolveDOMElement(target)`.

- [ ] **Step 1: Write failing facade tests for selector and Element inputs**

Add a fixture method and two tests to `tests/facade-dom.test.ts`:

```ts
getComponentFromElement: vi.fn(() => ({
  componentId: "app-a:1",
  name: "UserCard",
})),
```

```ts
it.each([
  ["selector", () => "#user-card"],
  ["Element", () => document.querySelector("#user-card")!],
])("resolves a component from a %s", async (_label, target) => {
  const element = document.createElement("article");
  element.id = "user-card";
  document.body.append(element);
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
  expect(source.getComponentFromElement).toHaveBeenCalledWith("app-a", element);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/facade-dom.test.ts`

Expected: FAIL because `getComponentFromDOM` and `getComponentFromElement` do not exist.

- [ ] **Step 3: Add the minimal public and data-source types**

Add to `src/public-types.ts`:

```ts
export interface ComponentFromDOMResult {
  appId: string;
  componentId: string;
  name: string;
}

export interface ComponentFromDOMOptions {
  appId?: string;
  expectedRevision?: number;
}
```

Add `componentFromDOM: true` to `ProbeCapabilities` and add to `ProbeAPI`:

```ts
getComponentFromDOM(
  target: string | Element,
  options?: ComponentFromDOMOptions,
): Promise<ProbeResult<ComponentFromDOMResult>>;
```

Add to `src/data-source/types.ts`:

```ts
export interface RawComponentIdentity {
  componentId: string;
  name: string;
}

getComponentFromElement(
  appId: string,
  element: Element,
): RawComponentIdentity;
```

- [ ] **Step 4: Add target validation and selector resolution**

Add to `src/core/validation.ts`:

```ts
export function validateComponentFromDOM(
  target: unknown,
  value: unknown,
): { target: string | Element; options: ComponentFromDOMOptions } {
  const record = copyPlainRecord(value, "options", [
    "appId",
    "expectedRevision",
  ]);
  optionalId(record.appId, "appId");
  optionalRevision(record.expectedRevision);
  if (typeof target === "string") {
    if (target.trim().length === 0) invalid("target selector must be non-empty");
    return { target, options: record as unknown as ComponentFromDOMOptions };
  }
  if (!isElementTarget(target))
    invalid("target must be a CSS selector or Element");
  return { target, options: record as unknown as ComponentFromDOMOptions };
}
```

Implement the cross-realm-safe guard used above:

```ts
function isElementTarget(value: unknown): value is Element {
  try {
    return (
      typeof value === "object" &&
      value !== null &&
      Reflect.get(value, "nodeType") === 1 &&
      typeof Reflect.get(value, "tagName") === "string"
    );
  } catch {
    return false;
  }
}
```

Add to `src/core/dom.ts`:

```ts
export function resolveDOMElement(target: string | Element): Element {
  if (typeof target !== "string") return target;
  if (typeof document === "undefined")
    throw new DataSourceError("NOT_READY", "DOM is not available");
  let element: Element | null;
  try {
    element = document.querySelector(target);
  } catch {
    throw new ProbeOptionsError("target must be a valid CSS selector");
  }
  if (!element)
    throw new DataSourceError(
      "COMPONENT_NOT_FOUND",
      `DOM target not found: ${target}`,
    );
  return element;
}
```

- [ ] **Step 5: Add the minimal facade method**

Import the new types/helpers in `src/core/facade.ts`, add `componentFromDOM: true`, and add:

```ts
getComponentFromDOM: (unsafeTarget, unsafeOptions = {}) =>
  validateAndRun(
    () => validateComponentFromDOM(unsafeTarget, unsafeOptions),
    ({ target, options }) =>
      runSnapshotForApp(
        options.appId,
        options.expectedRevision,
        (id, verifyUnchanged) => {
          const identity = source.getComponentFromElement(
            id,
            resolveDOMElement(target),
          );
          const result = { appId: id, ...identity };
          verifyUnchanged();
          return result;
        },
      ),
  ),
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npm test -- tests/facade-dom.test.ts`

Expected: PASS for selector and Element success cases and existing component-to-DOM cases.

- [ ] **Step 7: Add and run public error tests**

Add validation cases to `tests/facade-validation.test.ts`:

```ts
["DOM empty selector", (api: RuntimeProbeAPI) => api.getComponentFromDOM("", {})],
["DOM invalid target", (api: RuntimeProbeAPI) => api.getComponentFromDOM({}, {})],
["DOM expected revision", (api: RuntimeProbeAPI) =>
  api.getComponentFromDOM("#card", { expectedRevision: 1.5 })],
["DOM null options", (api: RuntimeProbeAPI) =>
  api.getComponentFromDOM("#card", null)],
```

Add runtime failures to `tests/facade-dom.test.ts`:

```ts
it.each([
  ["malformed selector", "[", "INVALID_OPTIONS"],
  ["missing selector", "#missing", "COMPONENT_NOT_FOUND"],
])("reports %s", async (_label, selector, code) => {
  const api = createProbeAPI(sourceFixture());
  await expect(api.getComponentFromDOM(selector)).resolves.toMatchObject({
    ok: false,
    error: { code },
  });
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
```

Create `tests/dom-target.test.ts` without a jsdom environment:

```ts
import { describe, expect, it } from "vitest";
import { resolveDOMElement } from "../src/core/dom";

describe("DOM target resolution", () => {
  it("reports NOT_READY when a selector is used without a DOM", () => {
    expect(() => resolveDOMElement("#card")).toThrowError(
      expect.objectContaining({ code: "NOT_READY" }),
    );
  });
});
```

Run:

`npm test -- tests/facade-dom.test.ts tests/facade-validation.test.ts`

Expected: PASS with `INVALID_OPTIONS`, `COMPONENT_NOT_FOUND`, `NOT_READY`, and `STALE_REVISION` respectively; invalid inputs must not call the data source.

- [ ] **Step 8: Commit the facade slice**

```bash
git add src/public-types.ts src/core/validation.ts src/core/dom.ts src/core/facade.ts src/data-source/types.ts tests/facade-dom.test.ts tests/facade-validation.test.ts tests/dom-target.test.ts
git commit -m "feat: add component lookup from DOM facade"
```

---

### Task 2: DevTools owner lookup and app isolation

**Files:**
- Modify: `tests/devtools-data-source.test.ts`
- Modify: `src/data-source/devtools.ts`

**Interfaces:**
- Consumes: `RawComponentIdentity` and `ProbeDataSource.getComponentFromElement(appId, element)` from Task 1.
- Produces: `DevtoolsBridge.getComponentFromElement(appId, element): RawComponentIdentity | undefined`.
- Produces: pure `findComponentIdentity(app, element)` for guarded identity lookup tests.

- [ ] **Step 1: Write failing data-source tests**

Extend `bridgeFixture` with `getComponentFromElement: vi.fn()` and add tests proving that a found identity is returned, `undefined` maps to `COMPONENT_NOT_FOUND`, and the selected app id is passed unchanged.

```ts
it("returns the Vue owner identity for the selected app", () => {
  const fixture = bridgeFixture();
  const element = document.createElement("span");
  vi.mocked(fixture.bridge.getComponentFromElement).mockReturnValueOnce({
    componentId: "b:2",
    name: "UserCard",
  });
  const source = new DevtoolsDataSource(fixture.bridge);

  expect(source.getComponentFromElement("b", element)).toEqual({
    componentId: "b:2",
    name: "UserCard",
  });
  expect(fixture.bridge.getComponentFromElement).toHaveBeenCalledWith(
    "b",
    element,
  );
});

it("reports an element without an owner in the selected app", () => {
  const fixture = bridgeFixture();
  vi.mocked(fixture.bridge.getComponentFromElement).mockReturnValueOnce(undefined);
  const source = new DevtoolsDataSource(fixture.bridge);

  expect(() =>
    source.getComponentFromElement("a", {} as Element),
  ).toThrowError(expect.objectContaining({ code: "COMPONENT_NOT_FOUND" }));
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/devtools-data-source.test.ts`

Expected: FAIL because the bridge and data-source methods do not exist.

- [ ] **Step 3: Implement the data-source boundary**

Add to `DevtoolsBridge`:

```ts
getComponentFromElement(
  appId: string,
  element: Element,
): RawComponentIdentity | undefined;
```

Add to `DevtoolsDataSource`:

```ts
getComponentFromElement(
  appId: string,
  element: Element,
): RawComponentIdentity {
  this.assertApp(appId);
  const identity = this.bridge.getComponentFromElement(appId, element);
  if (!identity)
    throw new DataSourceError(
      "COMPONENT_NOT_FOUND",
      "Vue component not found for DOM element",
    );
  return identity;
}
```

- [ ] **Step 4: Write failing real bridge tests for ownership and isolation**

Import `findComponentIdentity`. Create app records whose `instanceMap`s contain distinct instance objects, then define `__vueParentComponent` on an element:

```ts
const instance = { type: { name: "UserCard" } };
const element = {} as Element;
Object.defineProperty(element, "__vueParentComponent", { value: instance });
const appA = {
  id: "app-a",
  name: "A",
  instanceMap: new Map([["app-a:1", instance]]),
};
const appB = {
  id: "app-b",
  name: "B",
  instanceMap: new Map<string, unknown>(),
};

expect(findComponentIdentity(appA, element)).toEqual({
  componentId: "app-a:1",
  name: "UserCard",
});
expect(findComponentIdentity(appB, element)).toBeUndefined();

const anonymous = { type: {} };
const anonymousElement = {} as Element;
Object.defineProperty(anonymousElement, "__vueParentComponent", {
  value: anonymous,
});
expect(
  findComponentIdentity(
    {
      id: "app-a",
      name: "A",
      instanceMap: new Map([["app-a:2", anonymous]]),
    },
    anonymousElement,
  ),
).toEqual({ componentId: "app-a:2", name: "Anonymous Component" });
```

Add the root and hostile-access cases:

```ts
const root: Record<string, unknown> = { type: {} };
root.root = root;
const rootElement = {} as Element;
Object.defineProperty(rootElement, "__vueParentComponent", { value: root });
expect(
  findComponentIdentity(
    {
      id: "app-a",
      name: "A",
      instanceMap: new Map([["app-a:root", root]]),
    },
    rootElement,
  ),
).toEqual({ componentId: "app-a:root", name: "Root" });

const hostileElement = Object.defineProperty({}, "__vueParentComponent", {
  get() {
    throw new Error("blocked");
  },
}) as Element;
expect(findComponentIdentity(appA, hostileElement)).toBeUndefined();
```

- [ ] **Step 5: Run the bridge tests and verify RED**

Run: `npm test -- tests/devtools-data-source.test.ts`

Expected: FAIL because `createKitBridge` does not perform reverse lookup.

- [ ] **Step 6: Implement identity lookup in `createKitBridge`**

Add a guarded helper equivalent to Vue DevTools naming rules:

```ts
function componentInstanceName(instance: unknown): string {
  try {
    if (!instance || typeof instance !== "object") return "Anonymous Component";
    const record = instance as Record<string, unknown>;
    const type = record.type;
    if (type && (typeof type === "object" || typeof type === "function"))
      for (const key of ["displayName", "name", "_componentTag", "__name"]) {
        const candidate = Reflect.get(type, key);
        if (typeof candidate === "string" && candidate.length > 0)
          return candidate;
      }
    if (record.root === instance) return "Root";
  } catch {
    return "Anonymous Component";
  }
  return "Anonymous Component";
}
```

Add `findComponentIdentity` without trusting a synthesized uid, then delegate to it from the bridge:

```ts
export function findComponentIdentity(
  app: BridgeAppRecord,
  element: Element,
): RawComponentIdentity | undefined {
  try {
    const instance = Reflect.get(element, "__vueParentComponent");
    if (!instance || !app?.instanceMap) return undefined;
    for (const [componentId, candidate] of app.instanceMap)
      if (candidate === instance)
        return { componentId, name: componentInstanceName(instance) };
  } catch {
    return undefined;
  }
  return undefined;
}

// Inside createKitBridge():
getComponentFromElement: (appId: string, element: Element) => {
  const app = devtools.ctx.state.appRecords.find(
    (record) => record.id === appId,
  );
  return app ? findComponentIdentity(app, element) : undefined;
},
```

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `npm test -- tests/devtools-data-source.test.ts tests/facade-dom.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the DevTools slice**

```bash
git add src/data-source/devtools.ts tests/devtools-data-source.test.ts
git commit -m "feat: resolve Vue component owners from elements"
```

---

### Task 3: Contract completeness, versions, and fixture compatibility

**Files:**
- Modify: `tests/facade.test.ts`
- Modify: `tests/json-contract.test.ts`
- Modify: `tests/types-dist/consumer.ts`
- Modify: `tests/client.test.ts`
- Modify: `tests/client-nonconfig.test.ts`
- Modify: `tests/facade-envelope.test.ts`
- Modify: `tests/facade-revision.test.ts`
- Modify: `tests/pinia-inspector-contract.test.ts`
- Modify: `tests/vue-pinia-runtime.test.ts`
- Modify: every other typed `ProbeDataSource` fixture reported by `npm run typecheck`
- Modify: `src/core/facade.ts`

**Interfaces:**
- Consumes: the public and data-source interfaces from Tasks 1–2.
- Produces: API 0.4.0 capability and distribution-contract coverage.

- [ ] **Step 1: Write failing version, capability, wire, and type tests**

Update expectations to `0.4.0`, require `componentFromDOM: true`, add `getComponentFromDOM` to the JSON-safe result list (length becomes 9), and add to `tests/types-dist/consumer.ts`:

```ts
import type {
  ComponentFromDOMOptions,
  ComponentFromDOMResult,
} from "vite-plugin-vue-probe";

declare const element: Element;
declare const fromDOMOptions: ComponentFromDOMOptions;
void api.getComponentFromDOM("#user-card", fromDOMOptions);
void api.getComponentFromDOM(element, { appId: "app-1", expectedRevision: 4 });
const identity: ComponentFromDOMResult = {
  appId: "app-1",
  componentId: "app-1:1",
  name: "UserCard",
};
void identity;

// @ts-expect-error DOM lookup does not accept arbitrary objects.
void api.getComponentFromDOM({}, {});
```

- [ ] **Step 2: Run contract checks and verify RED**

Run: `npm test -- tests/facade.test.ts tests/json-contract.test.ts && npm run typecheck`

Expected: FAIL on old API version/capability and missing fixture methods.

- [ ] **Step 3: Complete API 0.4.0 and fixture updates**

Set `PROBE_API_VERSION = "0.4.0"`. Add `getComponentFromElement: vi.fn()` or a stable `{ componentId, name }` fixture implementation beside every existing `getComponentRoots` fixture. Update the exact runtime API key expectation in `tests/facade-validation.test.ts` to include `getComponentFromDOM`.

- [ ] **Step 4: Run unit and type contracts and verify GREEN**

Run:

```bash
npm test -- tests/facade.test.ts tests/json-contract.test.ts tests/facade-validation.test.ts
npm run typecheck
npm run test:types-dist
```

Expected: all commands PASS.

- [ ] **Step 5: Commit the complete contract**

```bash
git add src/core/facade.ts tests
git commit -m "test: cover component lookup public contract"
```

---

### Task 4: English and Russian documentation

**Files:**
- Modify: `README.md`
- Modify: `README_ru.md`

**Interfaces:**
- Consumes: API 0.4.0 `getComponentFromDOM` behavior from Tasks 1–3.
- Produces: copy-pasteable examples for selector and Element use.

- [ ] **Step 1: Update every API version reference**

Replace public-contract, console, and capability examples from `0.3.0` to `0.4.0` in both READMEs and show `componentFromDOM: true` in capability output.

- [ ] **Step 2: Add DOM-to-component examples**

Add an English section after component DOM locators:

```js
const bySelector = await $probe.getComponentFromDOM("#user-card");
const element = document.querySelector("#user-card");
const byElement = await $probe.getComponentFromDOM(element);

if (bySelector.ok) {
  const state = await $probe.getComponentState(bySelector.data.componentId, {
    appId: bySelector.data.appId,
  });
  console.log($probe.formatters.toMarkdown(state.ok ? state.data.state : state));
}
```

Add the equivalent Russian explanation and code example to `README_ru.md`. State that the nearest Vue owner is returned, selectors use the first DOM match, and failures use the standard envelope.

- [ ] **Step 3: Verify documentation references**

Run:

```bash
rg -n "0\.3\.0|componentFromDOM|getComponentFromDOM" README.md README_ru.md src tests
```

Expected: no `0.3.0` references; both READMEs document both input forms.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md README_ru.md
git commit -m "docs: document DOM to component lookup"
```

---

### Task 5: Final verification

**Files:**
- Verify only; modify production or tests only if a command reveals a defect.

**Interfaces:**
- Consumes: all prior task deliverables.
- Produces: verified source, build, ESM distribution, and declaration artifacts.

- [ ] **Step 1: Run formatting-independent diff checks**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 2: Run the complete unit suite**

Run: `npm test`

Expected: all Vitest files and tests PASS with no unhandled errors.

- [ ] **Step 3: Run compile and distribution verification**

Run:

```bash
npm run typecheck
npm run build
npm run test:dist
npm run test:types-dist
```

Expected: all commands exit 0; the generated ESM package imports and exported declarations accept both selector and Element targets.

- [ ] **Step 4: Review the final diff and status**

Run:

```bash
git status --short
git diff --stat HEAD~4..HEAD
git log -5 --oneline
```

Expected: only scoped source, test, README, spec, and plan changes; no generated or unrelated files.

- [ ] **Step 5: Commit verification-only fixes if needed**

If verification required a code correction, rerun the failing command and stage only the feature files that changed:

```bash
git add src/public-types.ts src/core/dom.ts src/core/facade.ts src/core/validation.ts src/data-source/types.ts src/data-source/devtools.ts tests README.md README_ru.md
git commit -m "fix: harden DOM component lookup"
```
