# vite-plugin-vue-probe

[English](./README.md) · [Русский](./README_ru.md)

Dev-only Vite plugin that exposes a read-only `window.VUE_PROBE` for precise Vue 3 runtime inspection — useful for AI agents, Playwright/Cypress scripts, custom tooling, and local debugging.

Built on Vue DevTools v8 (`@vue/devtools-kit`). Provides the component tree, component state, Pinia stores, lazy path-based reads, and component → DOM locators.

> **Status:** proof of concept. The API never ships in production builds, never mutates state, and never invokes actions.

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
// Is the probe installed?
window.VUE_PROBE?.version;

// Capabilities + apps
await window.VUE_PROBE.getCapabilities();
await window.VUE_PROBE.listApps();

// Flat component tree (first 3 levels)
const tree = await window.VUE_PROBE.getComponentTree({
  format: "flat",
  maxDepth: 3,
});
console.table(
  tree.ok
    ? tree.data.nodes.map((n) => ({ id: n.id, name: n.name, depth: n.depth }))
    : tree.error,
);

// Pick a real id from the tree, then inspect state / DOM
const id = tree.data.nodes.find((n) => n.name.includes("App"))?.id;
await window.VUE_PROBE.getComponentState(id);
await window.VUE_PROBE.getComponentDOM(id);

// Page a large / truncated path
await window.VUE_PROBE.getDetailedState(
  { kind: "component", componentId: id },
  ["setup", "rows"],
  { offset: 0, limit: 50 },
);

// Pinia (when registered)
await window.VUE_PROBE.getPiniaStores();
await window.VUE_PROBE.getPiniaState("users");
```

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
- Event timeline, subscriptions, state mutation, and action calls are out of scope for v1
- Intended for trusted local development — runtime state may contain secrets

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
```

---

## License

MIT
