# vite-plugin-vue-probe

[English](./README.md) · [Русский](./README_ru.md)

Dev-only Vite plugin that exposes a read-only `window.VUE_PROBE` for precise Vue 3 runtime inspection — useful for AI agents, Playwright/Cypress scripts, custom tooling, and local debugging.

Built on Vue DevTools v8 (`@vue/devtools-kit`). Provides the component tree, component state, Pinia stores, lazy path-based reads, and component → DOM locators.

> **Status:** proof of concept. The API never ships in production builds, never mutates state, and never invokes actions.

The current public contract is **API 0.2.0**.

---

## Features

| Capability      | Description                                                               |
| --------------- | ------------------------------------------------------------------------- |
| Component tree  | Nested or flat tree with depth limits and name filters                    |
| Component state | Props, setup, data, computed, attrs, provide/inject, refs                 |
| Pinia           | Store list and budgeted store state when the inspector is registered      |
| Lazy paths      | Page large values via `getDetailedState` without dumping the whole object |
| DOM locators    | JSON selectors / rects for a component’s root elements                    |
| Safe envelope   | Every call returns `ProbeResult<T>` — success or structured error         |

---

## Install

Not published to npm yet. Install from GitHub (builds via `prepare`):

```bash
npm install -D github:mewforest/vite-plugin-vue-probe
```

Or from a local clone of this repo:

```bash
npm install -D /absolute/path/to/vite-plugin-vue-probe
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueProbe from "vite-plugin-vue-probe";

export default defineConfig({
  plugins: [vueProbe(), vue()],
});
```

The plugin uses `apply: 'serve'`, so `window.VUE_PROBE` exists only during `vite serve`.

Temporarily disable without removing the plugin:

```ts
vueProbe({ enabled: false });
```

---

## DevTools console

With `vite serve` running and the plugin enabled, open the page → DevTools → **Console**:

```js
const probe = window.VUE_PROBE;
if (!probe) throw new Error("VUE_PROBE is not installed");

const capabilities = await probe.getCapabilities();
if (!capabilities.ok) throw new Error(capabilities.error.message);
const apps = await probe.listApps();
if (!apps.ok) throw new Error(apps.error.message);

// Flat component tree (first 3 levels)
const tree = await probe.getComponentTree({
  format: "flat",
  maxDepth: 3,
});
if (!tree.ok) throw new Error(tree.error.message);
console.table(tree.data.nodes.map((n) => ({
  id: n.id,
  name: n.name,
  depth: n.depth,
})));

// Pick a real id from the tree, then inspect state / DOM in the same app
const id = tree.data.nodes.find((n) => n.name.includes("App"))?.id;
if (!id) throw new Error("Component not found in the returned tree");
const state = await probe.getComponentState(id, { appId: tree.data.appId });
if (!state.ok) throw new Error(state.error.message);
const dom = await probe.getComponentDOM(id, {
  appId: tree.data.appId,
  expectedRevision: tree.meta.revision,
});
if (!dom.ok) throw new Error(dom.error.message);

// Page a large / truncated path
const page = await probe.getDetailedState(
  { kind: "component", componentId: id, appId: tree.data.appId },
  ["setup", "rows"],
  { offset: 0, limit: 50, expectedRevision: tree.meta.revision },
);
if (!page.ok) throw new Error(page.error.message);
const pagination = page.data.page;
if (pagination?.nextOffset != null) {
  const next = await probe.getDetailedState(page.data.target, page.data.path, {
    offset: pagination.nextOffset,
    limit: pagination.limit,
    expectedRevision: page.meta.revision,
  });
  if (!next.ok) throw new Error(next.error.message);
}

// Pinia (when registered): IDs only by default; keys are opt-in
const stores = await probe.getPiniaStores({ appId: tree.data.appId });
if (!stores.ok) throw new Error(stores.error.message);
const storesWithKeys = await probe.getPiniaStores({
  appId: tree.data.appId,
  includeKeys: true,
});
if (!storesWithKeys.ok) throw new Error(storesWithKeys.error.message);
const pinia = await probe.getPiniaState("users", { appId: tree.data.appId });
if (!pinia.ok) throw new Error(pinia.error.message);
```

`getComponentDOM()` returns a selector relative to the node's root. For an
open Shadow DOM it also returns `shadowHostSelectors` in outer-to-inner order:
resolve each host, enter its `shadowRoot`, then resolve `selector`. Closed
shadow roots intentionally return `selector: null`.

Every call returns a JSON-safe envelope:

```ts
type ProbeResult<T> =
  | {
      ok: true;
      data: T;
      meta: { requestId: string; revision: number; observedAt: string };
    }
  | {
      ok: false;
      error: { code: string; message: string };
      meta: { requestId: string; revision: number; observedAt: string };
    };
```

If `window.VUE_PROBE` is `undefined`, the plugin is not injected (production build, `enabled: false`, or not in `vite.config`).

### Budgets and revisions

- Initial reads default to depth `2`, `25` entries, and `500` string characters; detailed reads default to depth `3` and page size `50`.
- For serialized component/Pinia/detail state data, hard limits are depth `20`, `200` entries per container/page, `100,000` characters per string, `1,000,000` aggregate emitted string characters, and `5,000` serialized nodes. This aggregate limit does not describe envelopes, app lists, or component trees. Identifier/path length and offset limits are reported by `getCapabilities()`.
- `revision` is an inspector-invalidation token, not a mutation counter. Component lifecycle/update events and Pinia inspector-state invalidation advance it; an unattributed invalidation conservatively advances every live app.
- Snapshot reads check revision before and after the read. A mismatched `expectedRevision`, or an update during the read, returns `STALE_REVISION`; retry from a fresh response revision.

---

## AI agent skill

This repo ships a Cursor Agent Skill that teaches models how to call `window.VUE_PROBE` safely (budgets, truncation, error envelopes).

**Install into a consumer project** (after installing the plugin):

```bash
# From this repo / package root
mkdir -p .cursor/skills
cp -R skills/vue-probe .cursor/skills/vue-probe
```

Or for your user (all projects):

```bash
mkdir -p ~/.cursor/skills
cp -R skills/vue-probe ~/.cursor/skills/vue-probe
```

Skill source: [`skills/vue-probe/SKILL.md`](./skills/vue-probe/SKILL.md).

After install, agents can use it when debugging Vue runtime state, writing Playwright probes, or when you mention `VUE_PROBE` / `vite-plugin-vue-probe`.

---

## PoC limitations

- Vue 3 + Vite dev server only — no production API surface
- Pinia works when the app registers its custom inspector
- Fragment/Suspense/Teleport/KeepAlive root extraction is structural and bounded; it depends on the Vue DevTools VNode shapes available at runtime
- Runtime tests pin `vue@3.5.22` and `pinia@3.0.3`: they mount Fragment, Suspense, Teleport, KeepAlive, two apps, and option/setup stores. The real DevTools browser hook remains the consumer-application integration boundary
- Event timeline, subscriptions, state mutation, and action calls are out of scope for v1
- Intended for trusted local development — runtime state may contain secrets

The dev client owns its DevTools subscriptions and releases them on HMR dispose/uninstall. Package entrypoints are emitted as Node-compatible ESM and covered by a dist import smoke test.

---

## Architecture

```text
DevtoolsDataSource → normalizer → budgeted serializer → Probe API facade
```

Vue DevTools types never leak into the public contract. If this lands in `vuejs/devtools` later, only the data source / registration layer needs to change; the serializer and consumer-friendly API stay the same.

---

## Scripts

```bash
npm test
npm run typecheck
npm run build
npm run test:dist
npm run test:types-dist
```

---

## License

MIT
