# vite-plugin-vue-agent

Dev-only Vite-плагин, который публикует read-only `window.AGENT_API` для точной инспекции Vue 3 приложений агентскими LLM. PoC использует Vue DevTools v8 (`@vue/devtools-kit`) и предоставляет дерево компонентов, component state, Pinia, ленивое path-based чтение и component → DOM locators.

> Статус: proof of concept. API намеренно не попадает в production build, не изменяет state и не вызывает actions.

## Установка и подключение

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

Плагин имеет `apply: 'serve'`: `window.AGENT_API` создаётся только при `vite serve`. Для временного отключения используйте `vueAgent({ enabled: false })`.

## Типичный сценарий для агента

```js
const apps = await window.AGENT_API.listApps()
const tree = await window.AGENT_API.getComponentTree({ format: 'flat', maxDepth: 3 })
const state = await window.AGENT_API.getComponentState('app-id:42')

// Большие значения возвращаются как {$type: 'truncated', path, total, nextOffset, ...}.
const page = await window.AGENT_API.getDetailedState(
  { kind: 'component', componentId: 'app-id:42' },
  ['setup', 'rows'],
  { offset: 0, limit: 50 },
)

const dom = await window.AGENT_API.getComponentDOM('app-id:42')
```

Все методы асинхронны и возвращают JSON-safe union:

```ts
type AgentResult<T> =
  | { ok: true; data: T; meta: { requestId: string; revision: number; observedAt: string } }
  | { ok: false; error: { code: string; message: string }; meta: { requestId: string; revision: number; observedAt: string } }
```

Полный контракт, ограничения и исследование upstream: [`outputs/vite-plugin-vue-agent-api-spec.md`](outputs/vite-plugin-vue-agent-api-spec.md).

## Ограничения PoC

- Vue 3 и Vite dev server; API отсутствует в production.
- Pinia доступна, когда её custom inspector зарегистрирован приложением.
- Event timeline, subscriptions, mutation state и вызов actions не входят в v1.
- API предназначен только для доверенной локальной разработки: runtime state может содержать чувствительные данные.

## Архитектура

`DevtoolsDataSource → normalizer → budgeted serializer → Agent API facade`. Типы Vue DevTools не выходят в публичный контракт. При переносе в `vuejs/devtools` заменяется data source/регистрация, а serializer и LLM-friendly API сохраняются.

## Проверка

```bash
npm test
npm run typecheck
npm run build
```
