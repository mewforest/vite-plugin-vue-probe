# vite-plugin-vue-agent

[English](./README.md) · [Русский](./README_ru.md)

Dev-only Vite plugin that exposes a read-only `window.AGENT_API` for precise Vue 3 inspection by agentic LLMs.

Built on Vue DevTools v8 (`@vue/devtools-kit`). Provides the component tree, component state, Pinia stores, lazy path-based reads, and component → DOM locators.

> **Status:** proof of concept. The API never ships in production builds, never mutates state, and never invokes actions.

---

## Features

| Capability | Description |
| --- | --- |
| Component tree | Nested or flat tree with depth limits and name filters |
| Component state | Props, setup, data, computed, attrs, provide/inject, refs |
| Pinia | Store list and budgeted store state when the inspector is registered |
| Lazy paths | Page large values via `getDetailedState` without dumping the whole object |
| DOM locators | JSON selectors / rects for a component’s root elements |
| Safe envelope | Every call returns `AgentResult<T>` — success or structured error |

---

## Install

```bash
npm install -D vite-plugin-vue-agent
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueAgent from 'vite-plugin-vue-agent'

export default defineConfig({
  plugins: [vueAgent(), vue()],
})
```

The plugin uses `apply: 'serve'`, so `window.AGENT_API` exists only during `vite serve`.

Temporarily disable without removing the plugin:

```ts
vueAgent({ enabled: false })
```

---

## Agent workflow

```js
const apps = await window.AGENT_API.listApps()
const tree = await window.AGENT_API.getComponentTree({ format: 'flat', maxDepth: 3 })
const state = await window.AGENT_API.getComponentState('app-id:42')

// Oversized values come back as {$type: 'truncated', path, total, nextOffset, ...}
const page = await window.AGENT_API.getDetailedState(
  { kind: 'component', componentId: 'app-id:42' },
  ['setup', 'rows'],
  { offset: 0, limit: 50 },
)

const dom = await window.AGENT_API.getComponentDOM('app-id:42')
```

All methods are async and return a JSON-safe union:

```ts
type AgentResult<T> =
  | { ok: true; data: T; meta: { requestId: string; revision: number; observedAt: string } }
  | { ok: false; error: { code: string; message: string }; meta: { requestId: string; revision: number; observedAt: string } }
```

Full contract, limits, and upstream research: [`outputs/vite-plugin-vue-agent-api-spec.md`](outputs/vite-plugin-vue-agent-api-spec.md).

---

## PoC limitations

- Vue 3 + Vite dev server only — no production API surface
- Pinia works when the app registers its custom inspector
- Event timeline, subscriptions, state mutation, and action calls are out of scope for v1
- Intended for trusted local development — runtime state may contain secrets

---

## Architecture

```text
DevtoolsDataSource → normalizer → budgeted serializer → Agent API facade
```

Vue DevTools types never leak into the public contract. If this lands in `vuejs/devtools` later, only the data source / registration layer needs to change; the serializer and LLM-friendly API stay the same.

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
