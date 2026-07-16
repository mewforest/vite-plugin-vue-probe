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

## Typical workflow

```js
const apps = await window.VUE_PROBE.listApps();
const tree = await window.VUE_PROBE.getComponentTree({
  format: "flat",
  maxDepth: 3,
});
const state = await window.VUE_PROBE.getComponentState("app-id:42");

// Oversized values come back as {$type: 'truncated', path, total, nextOffset, ...}
const page = await window.VUE_PROBE.getDetailedState(
  { kind: "component", componentId: "app-id:42" },
  ["setup", "rows"],
  { offset: 0, limit: 50 },
);

const dom = await window.VUE_PROBE.getComponentDOM("app-id:42");
```

All methods are async and return a JSON-safe union:

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
