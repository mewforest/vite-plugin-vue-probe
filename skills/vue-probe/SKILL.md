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
This workflow targets API `0.2.0`; verify `window.VUE_PROBE.version` first.

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
- Keep the selected `appId` on state and DOM reads in multi-app pages.
- Treat `revision` as inspector invalidation. A snapshot can become stale while it is being read.

## Workflow

```js
const probe = window.VUE_PROBE;
if (!probe) throw new Error("VUE_PROBE missing");
const caps = await probe.getCapabilities();
if (!caps.ok) throw new Error(caps.error.message);
const apps = await probe.listApps();
if (!apps.ok) throw new Error(apps.error.message);

const tree = await probe.getComponentTree({
  format: "flat",
  maxDepth: 3,
  filter: "User", // optional name filter
});
if (!tree.ok) throw new Error(tree.error.message);

const component = tree.data.nodes.find((node) => node.name === "UserCard");
if (!component) throw new Error("No matching component");
const id = component.id;
const state = await probe.getComponentState(id, { appId: tree.data.appId });
if (!state.ok) throw new Error(state.error.message);
const dom = await probe.getComponentDOM(id, {
  appId: tree.data.appId,
  expectedRevision: tree.meta.revision,
});
if (!dom.ok) throw new Error(dom.error.message);

// Page a truncated path
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

const stores = await probe.getPiniaStores({ appId: tree.data.appId }); // IDs only
if (!stores.ok) throw new Error(stores.error.message);
const storesWithKeys = await probe.getPiniaStores({
  appId: tree.data.appId,
  includeKeys: true,
});
if (!storesWithKeys.ok) throw new Error(storesWithKeys.error.message);
const pinia = await probe.getPiniaState("users", { appId: tree.data.appId });
if (!pinia.ok) throw new Error(pinia.error.message);
```

Hard limits exposed by capabilities for serialized state data include depth
`20`, entries/page `200`, string length `100000`, aggregate string output
`1000000`, and `5000` serialized nodes. The aggregate does not describe
envelopes, app lists, or trees. Never try to
work around a hard limit by requesting a single oversized payload; page it.

To replay a DOM locator, start at `document`, resolve every
`shadowHostSelectors` entry in order and enter the host's open `shadowRoot`,
then resolve `selector`. `selector: null` means no safe replayable locator is
available (detached node, ambiguous path, or closed shadow root).

`getComponentDOM()` is limited to 200 DOM roots. Use it for a specific rendered
component (for example, the filtered `UserCard` above), not the root application
component. If it returns `INTERNAL_ERROR` about that limit, narrow the tree
filter or choose a more specific child component.

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

On `STALE_REVISION`, discard the partial workflow and start from a fresh tree/state response. Use its latest `meta.revision`; omit `expectedRevision` unless coordinating snapshot pages.
