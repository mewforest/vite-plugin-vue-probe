# vite-plugin-vue-probe

[English](./README.md) · [Русский](./README_ru.md)

Dev-only Vite-плагин, который публикует read-only `window.VUE_PROBE` для точной инспекции Vue 3 в runtime — для ИИ-агентов, Playwright/Cypress, кастомного tooling и локальной отладки.

PoC опирается на Vue DevTools v8 (`@vue/devtools-kit`) и даёт дерево компонентов, component state, Pinia, ленивое path-based чтение и component → DOM locators.

> **Статус:** proof of concept. API намеренно не попадает в production build, не изменяет state и не вызывает actions.

Текущая версия публичного контракта — **API 0.2.0**.

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
const probe = window.VUE_PROBE;
if (!probe) throw new Error("VUE_PROBE не установлен");

const capabilities = await probe.getCapabilities();
if (!capabilities.ok) throw new Error(capabilities.error.message);
const apps = await probe.listApps();
if (!apps.ok) throw new Error(apps.error.message);

// Flat-дерево (первые 3 уровня)
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

// Возьмите реальный id из дерева, затем state / DOM того же приложения
const id = tree.data.nodes.find((n) => n.name.includes("App"))?.id;
if (!id) throw new Error("Компонент не найден в дереве");
const state = await probe.getComponentState(id, { appId: tree.data.appId });
if (!state.ok) throw new Error(state.error.message);
const dom = await probe.getComponentDOM(id, {
  appId: tree.data.appId,
  expectedRevision: tree.meta.revision,
});
if (!dom.ok) throw new Error(dom.error.message);

// Дочитать большой / truncated path
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

// Pinia (если inspector зарегистрирован): по умолчанию только ID
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

`getComponentDOM()` возвращает selector относительно root узла. Для открытого
Shadow DOM поле `shadowHostSelectors` задаёт цепочку снаружи внутрь: найти host,
перейти в его `shadowRoot`, затем применить итоговый `selector`. Для закрытого
shadow root намеренно возвращается `selector: null`.

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

### Budgets и revisions

- Initial read: depth `2`, `25` entries и `500` символов строки; detailed read: depth `3`, page size `50`.
- Для serialized component/Pinia/detail state data hard limits равны depth `20`, `200` entries на container/page, `100 000` символов на строку, `1 000 000` символов суммарно и `5 000` узлов. Aggregate limit не относится к envelope, app list и component tree. Ограничения identifier/path/offset публикует `getCapabilities()`.
- `revision` — token инвалидизации inspector, а не счётчик mutations. Его меняют component lifecycle/update events и инвалидизация Pinia inspector state; событие без appId консервативно инвалидирует все live apps.
- Snapshot read проверяет revision до и после чтения. Несовпавший `expectedRevision` или update во время чтения даёт `STALE_REVISION`; повторять нужно с revision свежего ответа.

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
- Root extraction для Fragment/Suspense/Teleport/KeepAlive структурный и ограниченный; он зависит от доступной runtime-формы Vue DevTools VNode
- Runtime tests фиксируют `vue@3.5.22` и `pinia@3.0.3`: монтируются Fragment, Suspense, Teleport, KeepAlive, два приложения и option/setup stores. Реальный browser DevTools hook остаётся integration boundary consumer-приложения
- Event timeline, subscriptions, mutation state и вызов actions не входят в v1
- API только для доверенной локальной разработки — runtime state может содержать чувствительные данные

Dev client владеет DevTools subscriptions и освобождает их при HMR dispose/uninstall. Package entrypoints собираются как Node-compatible ESM и проверяются dist import smoke test.

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
npm run test:dist
npm run test:types-dist
```

---

## Лицензия

MIT
