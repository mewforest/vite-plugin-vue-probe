# vite-plugin-vue-agent

[English](./README.md) · [Русский](./README_ru.md)

Dev-only Vite-плагин, который публикует read-only `window.AGENT_API` для точной инспекции Vue 3 приложений агентскими LLM.

PoC опирается на Vue DevTools v8 (`@vue/devtools-kit`) и даёт дерево компонентов, component state, Pinia, ленивое path-based чтение и component → DOM locators.

> **Статус:** proof of concept. API намеренно не попадает в production build, не изменяет state и не вызывает actions.

---

## Возможности

| Возможность | Описание |
| --- | --- |
| Дерево компонентов | Nested или flat, с лимитом глубины и фильтром по имени |
| Состояние компонента | Props, setup, data, computed, attrs, provide/inject, refs |
| Pinia | Список store и budgeted state, если inspector зарегистрирован |
| Ленивые paths | Дочитывание больших значений через `getDetailedState` без полного dump |
| DOM-локаторы | JSON selectors / rects для корневых элементов компонента |
| Безопасный ответ | Каждый вызов — `AgentResult<T>`: успех или структурированная ошибка |

---

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

Плагин использует `apply: 'serve'`: `window.AGENT_API` создаётся только при `vite serve`.

Временно отключить без удаления из конфига:

```ts
vueAgent({ enabled: false })
```

---

## Типичный сценарий для агента

```js
const apps = await window.AGENT_API.listApps()
const tree = await window.AGENT_API.getComponentTree({ format: 'flat', maxDepth: 3 })
const state = await window.AGENT_API.getComponentState('app-id:42')

// Большие значения возвращаются как {$type: 'truncated', path, total, nextOffset, ...}
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

---

## Ограничения PoC

- Только Vue 3 и Vite dev server — в production API нет
- Pinia доступна, когда её custom inspector зарегистрирован приложением
- Event timeline, subscriptions, mutation state и вызов actions не входят в v1
- API только для доверенной локальной разработки — runtime state может содержать чувствительные данные

---

## Архитектура

```text
DevtoolsDataSource → normalizer → budgeted serializer → Agent API facade
```

Типы Vue DevTools не выходят в публичный контракт. При переносе в `vuejs/devtools` меняются data source / регистрация; serializer и LLM-friendly API сохраняются.

---

## Проверка

```bash
npm test
npm run typecheck
npm run build
```

---

## Лицензия

MIT
