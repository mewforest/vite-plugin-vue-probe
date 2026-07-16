---
name: vue-probe
description: >-
  Inspect a running Vue 3 app via window.VUE_PROBE (component tree, state,
  Pinia, DOM locators). Use when debugging Vue UI bugs, verifying runtime
  state, writing Playwright/Cypress probes, or when the user mentions
  vite-plugin-vue-probe / VUE_PROBE.
---

# Vue Probe

Read-only runtime inspection for Vue 3 apps that use `vite-plugin-vue-probe`.
API exists only during `vite serve` as `window.VUE_PROBE`.

## Preconditions

1. Confirm the app is on a Vite **dev** server (not production).
2. In the page context, check:

```js
typeof window.VUE_PROBE;
```

If `undefined`, the plugin is missing, disabled, or this is a production build. Stop and tell the user.

## Rules

- **Read-only** — never invent mutation helpers; v1 cannot edit state or call actions.
- Every method returns `ProbeResult<T>`: `{ ok: true, data, meta }` or `{ ok: false, error, meta }`.
- Always check `ok` before using `data`.
- Prefer `format: 'flat'` + `maxDepth` for trees; page large values with `getDetailedState`.
- Oversized values arrive as `{ $type: 'truncated', path, total, nextOffset, ... }` — page them, do not dump blindly.

## Workflow

```js
const caps = await window.VUE_PROBE.getCapabilities();
const apps = await window.VUE_PROBE.listApps();

const tree = await window.VUE_PROBE.getComponentTree({
  format: "flat",
  maxDepth: 3,
  filter: "User", // optional name filter
});

const id = tree.data.nodes[0].id;
const state = await window.VUE_PROBE.getComponentState(id);
const dom = await window.VUE_PROBE.getComponentDOM(id);

// Page a truncated path
const page = await window.VUE_PROBE.getDetailedState(
  { kind: "component", componentId: id },
  ["setup", "rows"],
  { offset: 0, limit: 50 },
);

const stores = await window.VUE_PROBE.getPiniaStores();
const pinia = await window.VUE_PROBE.getPiniaState("users");
```

## From Playwright / browser tools

Run the same calls inside the page:

```js
await page.evaluate(async () => {
  const api = window.VUE_PROBE;
  if (!api)
    return {
      ok: false,
      error: { code: "NOT_AVAILABLE", message: "VUE_PROBE missing" },
    };
  return api.getComponentTree({ format: "flat", maxDepth: 2 });
});
```

## Error codes

`NOT_READY` · `APP_NOT_FOUND` · `COMPONENT_NOT_FOUND` · `STORE_NOT_FOUND` · `PATH_NOT_FOUND` · `INVALID_OPTIONS` · `STALE_REVISION` · `INTERNAL_ERROR`

On `STALE_REVISION`, re-read with the latest `meta.revision` (omit `expectedRevision` unless coordinating concurrent readers).
