# vite-plugin-vue-probe

[English](./README.md) · [Русский](./README_ru.md)

Dev-only Vite-плагин, который публикует read-only `window.VUE_PROBE` для точной инспекции Vue 3 в runtime — для ИИ-агентов, Playwright/Cypress, кастомного tooling и локальной отладки.

PoC опирается на Vue DevTools v8 (`@vue/devtools-kit`) и даёт дерево компонентов, component state, Pinia, ленивое path-based чтение и component → DOM locators.

> **Статус:** proof of concept. API намеренно не попадает в production build, не изменяет state и не вызывает actions.

---

## Возможности

| Возможность          | Описание                                                               |
| -------------------- | ---------------------------------------------------------------------- |
| Дерево компонентов   | Nested или flat, с лимитом глубины и фильтром по имени                 |
| Состояние компонента | Props, setup, data, computed, attrs, provide/inject, refs              |
| Pinia                | Список store и budgeted state, если inspector зарегистрирован          |
| Ленивые paths        | Дочитывание больших значений через `getDetailedState` без полного dump |
| DOM-локаторы         | JSON selectors / rects для корневых элементов компонента               |
| Безопасный ответ     | Каждый вызов — `ProbeResult<T>`: успех или структурированная ошибка    |

---

## Установка и подключение

Пока пакет не опубликован в npm. Установка с GitHub (сборка через `prepare`):

```bash
npm install -D github:mewforest/vite-plugin-vue-probe
```

Или из локального клона этого репозитория:

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

Плагин использует `apply: 'serve'`: `window.VUE_PROBE` создаётся только при `vite serve`.

Временно отключить без удаления из конфига:

```ts
vueProbe({ enabled: false });
```

---

## Типичный сценарий

```js
const apps = await window.VUE_PROBE.listApps();
const tree = await window.VUE_PROBE.getComponentTree({
  format: "flat",
  maxDepth: 3,
});
const state = await window.VUE_PROBE.getComponentState("app-id:42");

// Большие значения возвращаются как {$type: 'truncated', path, total, nextOffset, ...}
const page = await window.VUE_PROBE.getDetailedState(
  { kind: "component", componentId: "app-id:42" },
  ["setup", "rows"],
  { offset: 0, limit: 50 },
);

const dom = await window.VUE_PROBE.getComponentDOM("app-id:42");
```

Все методы асинхронны и возвращают JSON-safe union:

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

## Ограничения PoC

- Только Vue 3 и Vite dev server — в production API нет
- Pinia доступна, когда её custom inspector зарегистрирован приложением
- Event timeline, subscriptions, mutation state и вызов actions не входят в v1
- API только для доверенной локальной разработки — runtime state может содержать чувствительные данные

---

## Архитектура

```text
DevtoolsDataSource → normalizer → budgeted serializer → Probe API facade
```

Типы Vue DevTools не выходят в публичный контракт. При переносе в `vuejs/devtools` меняются data source / регистрация; serializer и consumer-friendly API сохраняются.

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
