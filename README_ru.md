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

## Консоль DevTools

При запущенном `vite serve` и включённом плагине откройте страницу → DevTools → **Console**:

```js
// Плагин на месте?
window.VUE_PROBE?.version;

// Capabilities + apps
await window.VUE_PROBE.getCapabilities();
await window.VUE_PROBE.listApps();

// Flat-дерево (первые 3 уровня)
const tree = await window.VUE_PROBE.getComponentTree({
  format: "flat",
  maxDepth: 3,
});
console.table(
  tree.ok
    ? tree.data.nodes.map((n) => ({ id: n.id, name: n.name, depth: n.depth }))
    : tree.error,
);

// Возьмите реальный id из дерева, затем state / DOM
const id = tree.data.nodes.find((n) => n.name.includes("App"))?.id;
await window.VUE_PROBE.getComponentState(id);
await window.VUE_PROBE.getComponentDOM(id);

// Дочитать большой / truncated path
await window.VUE_PROBE.getDetailedState(
  { kind: "component", componentId: id },
  ["setup", "rows"],
  { offset: 0, limit: 50 },
);

// Pinia (если inspector зарегистрирован)
await window.VUE_PROBE.getPiniaStores();
await window.VUE_PROBE.getPiniaState("users");
```

Каждый вызов возвращает JSON-safe envelope:

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

Если `window.VUE_PROBE` — `undefined`, плагин не инжектится (production build, `enabled: false`, или нет в `vite.config`).

---

## Skill для ИИ-агентов

В репозитории есть Cursor Agent Skill: учит модели безопасно вызывать `window.VUE_PROBE` (budgets, truncation, error envelopes).

**Установка в проект-потребитель** (после установки плагина):

```bash
# Из корня этого репо / пакета
mkdir -p .cursor/skills
cp -R skills/vue-probe .cursor/skills/vue-probe
```

Или для пользователя (все проекты):

```bash
mkdir -p ~/.cursor/skills
cp -R skills/vue-probe ~/.cursor/skills/vue-probe
```

Исходник: [`skills/vue-probe/SKILL.md`](./skills/vue-probe/SKILL.md).

После установки агенты подхватывают skill при отладке Vue runtime, написании Playwright-проб или упоминании `VUE_PROBE` / `vite-plugin-vue-probe`.

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
