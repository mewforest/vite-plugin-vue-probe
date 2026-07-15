# 1. Отчёт об исследовании

Исследование выполнено по исходникам Vue DevTools v8.1.5 (бывший DevTools Next), commit [`8625b5713e164652995ce77ce2c8f2045b9458ba`](https://github.com/vuejs/devtools/commit/8625b5713e164652995ce77ce2c8f2045b9458ba). Ниже отдельно отмечено существующее поведение upstream и предлагаемое поведение `vite-plugin-vue-agent`.

## 1.1. Как DevTools подключается к Vue 3

Основной канал Vue 3 по-прежнему — `window.__VUE_DEVTOOLS_GLOBAL_HOOK__`. Это не `app.config.globalProperties` и не Vue-плагин, устанавливаемый через `app.use()`. Vue runtime отправляет в hook события `app:init`, `app:unmount`, `component:added`, `component:updated`, `component:removed`, `component:emit` и performance events.

DevTools Kit при инициализации:

1. создаёт совместимый global hook;
2. проигрывает callbacks из `window.__VUE_DEVTOOLS_HOOK_REPLAY__`, если Vue загрузился раньше DevTools;
3. устанавливает или обновляет `window.__VUE_DEVTOOLS_GLOBAL_HOOK__`;
4. преобразует события Vue runtime во внутренние hooks DevTools Kit;
5. на `app:init` создаёт `AppRecord`, выбирает активное приложение и регистрирует встроенный inspector `components`.

Если hook отсутствовал при загрузке Vue, Vue runtime временно буферизует события и помещает callback позднего подключения в `__VUE_DEVTOOLS_HOOK_REPLAY__`. Это позволяет Vite-инжекту подключиться после Vue, хотя для полноты дерева предпочтительна ранняя инъекция до entry module приложения.

Необходимо различать два объекта:

- `__VUE_DEVTOOLS_GLOBAL_HOOK__` — совместимый с Vue runtime внешний hook;
- `__VUE_DEVTOOLS_HOOK` — внутренняя `Hookable`-шина DevTools Kit, через которую его модули подписываются на уже нормализованные события.

Источники: [`packages/devtools-kit/src/core/index.ts`](https://github.com/vuejs/devtools/blob/8625b5713e164652995ce77ce2c8f2045b9458ba/packages/devtools-kit/src/core/index.ts), [`packages/devtools-kit/src/hook/index.ts`](https://github.com/vuejs/devtools/blob/8625b5713e164652995ce77ce2c8f2045b9458ba/packages/devtools-kit/src/hook/index.ts), [`Vue runtime-core/src/devtools.ts`](https://github.com/vuejs/core/blob/main/packages/runtime-core/src/devtools.ts).

### Вывод для PoC

Клиент `vite-plugin-vue-agent` должен вызывать `devtools.init()` как можно раньше и получать данные через внутренний адаптер `DevtoolsDataSource`. Публичный `window.AGENT_API` не должен возвращать `AppRecord`, `ComponentTreeNode`, `InspectorState` или другие upstream-типы: они не являются стабильным контрактом для стороннего пакета.

## 1.2. Дерево компонентов, имена и ID

Встроенный plugin `components` отвечает на запрос inspector tree с помощью `ComponentWalker`. Walker начинает с root instance выбранного `AppRecord` и обходит `instance.subTree`:

- обычный дочерний компонент берётся из `VNode.component`;
- массив `VNode.children` обходится рекурсивно;
- у `Suspense` выбирается активная ветка и добавляется соответствующий tag;
- у `KeepAlive` учитываются закэшированные, включая деактивированные, instances;
- у Fragment корневыми DOM-узлами считаются все подходящие дочерние roots.

Имя компонента выбирается из `displayName`, `name`, `_componentTag`, `__name`, имени `.vue`-файла или регистрации в локальном/глобальном registry. Последний fallback — `Anonymous Component`.

ID имеет вид `<appId>:root` для корня или `<appId>:<uid>` для остальных компонентов. `appId` строится из имени приложения и дедуплицируется, а Vue `uid` уникален внутри runtime. Полученный ID записывается в `instance.__VUE_DEVTOOLS_NEXT_UID__`, а instance — в `AppRecord.instanceMap`. Такой ID пригоден в пределах текущей сессии, но не должен считаться постоянным идентификатором между полными перезагрузками страницы.

Связь с DOM уже присутствует в DevTools: обычный компонент возвращает `instance.subTree.el`, Fragment — список корневых элементов дочерних VNodes. Для Agent API поверх этих элементов формируются только JSON locators; нативные `Element` не пересекают публичную границу.

Источники: [`core/plugin/components.ts`](https://github.com/vuejs/devtools/blob/8625b5713e164652995ce77ce2c8f2045b9458ba/packages/devtools-kit/src/core/plugin/components.ts), [`core/component/tree/walker.ts`](https://github.com/vuejs/devtools/blob/8625b5713e164652995ce77ce2c8f2045b9458ba/packages/devtools-kit/src/core/component/tree/walker.ts), [`core/component/tree/el.ts`](https://github.com/vuejs/devtools/blob/8625b5713e164652995ce77ce2c8f2045b9458ba/packages/devtools-kit/src/core/component/tree/el.ts), [`core/component/utils/index.ts`](https://github.com/vuejs/devtools/blob/8625b5713e164652995ce77ce2c8f2045b9458ba/packages/devtools-kit/src/core/component/utils/index.ts).

## 1.3. Извлечение состояния Vue-компонента

`processInstanceState()` формирует список inspector entries из нескольких источников:

- `props` — из `instance.props`, с prop metadata;
- `data` — Options API `instance.data` и render context;
- `setup` — из `instance.setupState`, а тип `ref`/`reactive`/`computed` определяется по `instance.devtoolsRawSetupState`;
- `computed` — Options API definitions, значение читается через component proxy;
- `attrs` — `instance.attrs`;
- `provided` и `injected` — `instance.provides` и merged component options;
- `template refs` — `instance.refs`;
- event listener metadata — из `instance.vnode.props`.

Доступ к каждому потенциально вычисляемому значению обёрнут в обработку ошибки. Это важно сохранить: getter или proxy может бросить исключение. Agent API должен сериализовать такую ошибку как данные, а не отклонять весь запрос.

Upstream replacer отдельно распознаёт Vue refs/reactive/computed, Date, Map, Set, bigint, Error, функции, DOM-элементы и ссылки на component instances. Циклические ссылки поддерживаются собственным index-based encoder/decoder.

Источники: [`core/component/state/process.ts`](https://github.com/vuejs/devtools/blob/8625b5713e164652995ce77ce2c8f2045b9458ba/packages/devtools-kit/src/core/component/state/process.ts), [`core/component/state/custom.ts`](https://github.com/vuejs/devtools/blob/8625b5713e164652995ce77ce2c8f2045b9458ba/packages/devtools-kit/src/core/component/state/custom.ts), [`core/component/state/replacer.ts`](https://github.com/vuejs/devtools/blob/8625b5713e164652995ce77ce2c8f2045b9458ba/packages/devtools-kit/src/core/component/state/replacer.ts).

## 1.4. Pinia

Pinia подключается через публичный `setupDevtoolsPlugin()` с descriptor `dev.esm.pinia` и создаёт custom inspector с ID `pinia`.

- Дерево inspector содержит root `_root` и зарегистрированные stores из `pinia._s`.
- Состояние store группируется в `state`, `getters` и `customProperties`.
- Hook `inspectComponent` добавляет используемые компонентом stores в его inspector state.
- Pinia также публикует mutations/actions в timeline и поддерживает редактирование, но эти возможности не входят в read-only v1 Agent API.

Полный store state не следует дублировать в каждом ответе компонента. Нормализатор заменяет Pinia-секции ссылкой `{ $type: "store-reference", storeId }`; подробные данные агент получает через `getPiniaState()` или `getDetailedState()`.

Источники: [`packages/pinia/src/devtools/plugin.ts`](https://github.com/vuejs/pinia/blob/v3/packages/pinia/src/devtools/plugin.ts), [`packages/pinia/src/devtools/formatting.ts`](https://github.com/vuejs/pinia/blob/v3/packages/pinia/src/devtools/formatting.ts).

## 1.5. Что DevTools действительно делает с большими значениями

В актуальном upstream нет универсального запроса «раскрыть значение по path».

Существуют три разных ограничения, которые легко ошибочно принять за lazy loading:

1. `stringifyReplacer` заменяет массив длиннее 5000 элементов объектом с `length` и первыми 5000 `items`; строку длиннее 10 000 символов обрезает.
2. `stringifyCircularAutoChunks` делит уже сериализованную строку на транспортные chunks по 2 MiB. Это chunking сообщения, а не дозагрузка ветки state.
3. `StateFieldViewer.vue` показывает первые 30 полей и по кнопке увеличивает локальный `limit` ещё на 30. Полное значение к этому моменту уже находится на стороне UI; новый state request по path не выполняется.

Следовательно, собственный path retrieval — не thin wrapper над готовой hydration-функцией DevTools, а новая возможность `vite-plugin-vue-agent`. Она должна читать текущее raw/inspector state повторно и применять существенно меньший LLM-oriented budget.

Источники: [`state/constants.ts`](https://github.com/vuejs/devtools/blob/8625b5713e164652995ce77ce2c8f2045b9458ba/packages/devtools-kit/src/core/component/state/constants.ts), [`state/replacer.ts`](https://github.com/vuejs/devtools/blob/8625b5713e164652995ce77ce2c8f2045b9458ba/packages/devtools-kit/src/core/component/state/replacer.ts), [`shared/transfer.ts`](https://github.com/vuejs/devtools/blob/8625b5713e164652995ce77ce2c8f2045b9458ba/packages/devtools-kit/src/shared/transfer.ts), [`StateFieldViewer.vue`](https://github.com/vuejs/devtools/blob/8625b5713e164652995ce77ce2c8f2045b9458ba/packages/applet/src/components/state/StateFieldViewer.vue).

## 1.6. Рекомендуемая граница архитектуры

```text
Vue runtime / Pinia
        ↓
@vue/devtools-kit inspectors
        ↓
DevtoolsDataSource          ← единственный слой, зависящий от upstream internals
        ↓
StateNormalizer             ← InspectorState → компактные секции и store references
        ↓
BudgetedSerializer          ← JSON-safe значения, depth/entry/string limits, paths
        ↓
AgentAPIFacade              ← стабильный window.AGENT_API
```

При будущем PR в `vuejs/devtools` можно заменить регистрацию/data source, оставив DTO, serializer, тесты контракта и инструкции для LLM без изменений.

# 2. Спецификация API (TypeScript)

## 2.1. Полный публичный контракт

Ниже приведён самодостаточный declaration-модуль. Все возвращаемые значения JSON-safe: в них нет функций, Symbols, Vue proxies, DOM nodes или нативных cyclic references.

```ts
export type JsonPrimitive = string | number | boolean | null
export type StatePath = Array<string | number>

export type AgentErrorCode =
  | 'NOT_READY'
  | 'APP_NOT_FOUND'
  | 'COMPONENT_NOT_FOUND'
  | 'STORE_NOT_FOUND'
  | 'PATH_NOT_FOUND'
  | 'INVALID_OPTIONS'
  | 'STALE_REVISION'
  | 'INTERNAL_ERROR'

export interface AgentError {
  code: AgentErrorCode
  message: string
  /** Дополнительные JSON-safe сведения без stack trace и raw objects. */
  details?: Record<string, JsonPrimitive | StatePath>
}

export interface ResponseMeta {
  /** Уникальный ID вызова для сопоставления с диагностикой плагина. */
  requestId: string
  /** Ревизия live-источника на момент чтения. */
  revision: number
  /** ISO 8601 timestamp на момент чтения. */
  observedAt: string
}

export interface AgentSuccess<T> {
  ok: true
  data: T
  meta: ResponseMeta
}

export interface AgentFailure {
  ok: false
  error: AgentError
  meta: ResponseMeta
}

export type AgentResult<T> = AgentSuccess<T> | AgentFailure

export interface UndefinedAgentValue {
  $type: 'undefined'
}

export interface NonFiniteNumberAgentValue {
  $type: 'number'
  value: 'NaN' | 'Infinity' | '-Infinity'
}

export interface BigIntAgentValue {
  $type: 'bigint'
  /** Десятичная запись без суффикса `n`. */
  value: string
}

export interface DateAgentValue {
  $type: 'date'
  /** ISO 8601, если дата валидна. */
  value: string
}

export interface MapAgentValue {
  $type: 'map'
  size: number
  entries: Array<[AgentValue, AgentValue]>
}

export interface SetAgentValue {
  $type: 'set'
  size: number
  values: AgentValue[]
}

export interface ErrorAgentValue {
  $type: 'error'
  name: string
  message: string
}

export interface CircularReferenceAgentValue {
  $type: 'circular-reference'
  /** Первый путь, на котором сериализатор встретил объект. */
  targetPath: StatePath
}

export interface StoreReferenceAgentValue {
  $type: 'store-reference'
  storeId: string
  appId?: string
}

export type TruncatedKind = 'array' | 'object' | 'string'

export interface TruncatedAgentValue {
  $type: 'truncated'
  kind: TruncatedKind
  /** Абсолютный путь относительно StateTarget. */
  path: StatePath
  /** Число элементов, ключей или символов в исходном значении. */
  total: number
  /** Число элементов, ключей или символов, помещённых в preview. */
  returned: number
  preview: AgentValue
  /** Следующий offset или null, если preview содержит остаток значения. */
  nextOffset: number | null
}

export type AgentSpecialValue =
  | UndefinedAgentValue
  | NonFiniteNumberAgentValue
  | BigIntAgentValue
  | DateAgentValue
  | MapAgentValue
  | SetAgentValue
  | ErrorAgentValue
  | CircularReferenceAgentValue
  | StoreReferenceAgentValue
  | TruncatedAgentValue

export type AgentValue =
  | JsonPrimitive
  | AgentSpecialValue
  | AgentValue[]
  | { [key: string]: AgentValue }

export interface AgentCapabilities {
  apiVersion: string
  vueDetected: boolean
  piniaDetected: boolean
  multipleApps: boolean
  componentTree: true
  componentState: true
  detailedState: true
  piniaState: boolean
  componentDOM: true
  stateMutation: false
  eventTimeline: false
  defaults: {
    maxDepth: 2
    maxEntries: 25
    maxStringLength: 500
    detailMaxDepth: 3
    detailPageSize: 50
    hardMaxEntries: 200
  }
}

export interface AppSummary {
  id: string
  name: string
  vueVersion: string
  active: boolean
  componentCount?: number
}

export type ComponentTreeFormat = 'nested' | 'flat'

export interface ComponentTreeOptions {
  /** По умолчанию используется активное приложение. */
  appId?: string
  /** Начать обход с указанного компонента; используется для lazy subtree. */
  rootId?: string
  /** Case-insensitive фильтр по имени компонента. */
  filter?: string
  /** `nested` по умолчанию. */
  format?: ComponentTreeFormat
  /** Глубина относительно rootId; null означает внутренний предел адаптера. */
  maxDepth?: number | null
  /** Добавить путь к `.vue`-файлу. По умолчанию false. */
  includeFile?: boolean
}

export interface ComponentTreeNode {
  id: string
  name: string
  parentId: string | null
  depth: number
  hasChildren: boolean
  inactive?: boolean
  fragment?: boolean
  file?: string
  /** Присутствует только при формате `nested`. */
  children?: ComponentTreeNode[]
}

export interface ComponentTreeResult {
  appId: string
  rootId: string
  format: ComponentTreeFormat
  nodes: ComponentTreeNode[]
  truncatedByDepth: boolean
}

export interface SerializationBudget {
  /** Initial read: 2; detail read: 3. Минимум 0. */
  maxDepth?: number
  /** Initial read: 25; detail read: 50; hard maximum: 200. */
  maxEntries?: number
  /** По умолчанию 500 символов. */
  maxStringLength?: number
}

export interface StateReadOptions extends SerializationBudget {
  /** По умолчанию используется активное приложение. */
  appId?: string
  /** При несовпадении вернуть STALE_REVISION вместо данных. */
  expectedRevision?: number
  /** Включить reactivity/prop metadata. По умолчанию false. */
  includeMetadata?: boolean
}

export type ComponentStateSection =
  | 'props'
  | 'setup'
  | 'data'
  | 'computed'
  | 'attrs'
  | 'provided'
  | 'injected'
  | 'refs'
  | 'pinia'

export type ComponentStateSections = Partial<
  Record<ComponentStateSection, Record<string, AgentValue>>
>

export interface StateEntryMetadata {
  reactivity?: 'ref' | 'reactive' | 'computed' | 'plain'
  readonly?: boolean
  propType?: string
  required?: boolean
}

export type ComponentStateMetadata = Partial<
  Record<ComponentStateSection, Record<string, StateEntryMetadata>>
>

export interface ComponentStateResult {
  appId: string
  componentId: string
  name: string
  file?: string
  state: ComponentStateSections
  metadata?: ComponentStateMetadata
}

export type StateTarget =
  | {
      kind: 'component'
      componentId: string
      appId?: string
    }
  | {
      kind: 'pinia'
      storeId: string
      appId?: string
    }

export interface DetailedStateOptions extends SerializationBudget {
  /** Offset для массива, объекта (в порядке Object.keys) или строки. */
  offset?: number
  /** По умолчанию 50, hard maximum 200. */
  limit?: number
  /** При несовпадении вернуть STALE_REVISION. */
  expectedRevision?: number
}

export interface StatePage {
  offset: number
  limit: number
  returned: number
  total: number
  nextOffset: number | null
}

export interface DetailedStateResult {
  target: StateTarget
  path: StatePath
  value: AgentValue
  /** Присутствует для paginated array/object/string. */
  page?: StatePage
}

export interface PiniaStoresOptions {
  /** По умолчанию используется активное приложение. */
  appId?: string
  filter?: string
}

export interface PiniaStoreSummary {
  appId: string
  id: string
  stateKeys: string[]
  getterKeys: string[]
  usedByComponentIds?: string[]
}

export interface PiniaStateResult {
  appId: string
  storeId: string
  state: Record<string, AgentValue>
  getters?: Record<string, AgentValue>
  customProperties?: Record<string, AgentValue>
}

export interface DOMRectJSON {
  x: number
  y: number
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}

export interface DOMNodeLocator {
  /** Позиция root element внутри компонента/Fragment. */
  index: number
  /** Selector проверен через document.querySelectorAll(selector).length === 1. */
  selector: string | null
  tag: string
  id?: string
  classes?: string[]
  /** Нормализованный и обрезанный текст, максимум 120 символов. */
  text?: string
  rect: DOMRectJSON
  connected: boolean
}

export interface ComponentDOMResult {
  appId: string
  componentId: string
  roots: DOMNodeLocator[]
}

export interface AgentAPI {
  readonly version: string

  /** Возвращает доступные источники и неизменяемые defaults текущей версии. */
  getCapabilities(): Promise<AgentResult<AgentCapabilities>>

  /** Перечисляет Vue applications, известные DevTools hook. */
  listApps(): Promise<AgentResult<AppSummary[]>>

  /**
   * Возвращает nested или flat component tree.
   * Для дозагрузки ветки повторить запрос с `rootId` равным ID узла.
   */
  getComponentTree(
    options?: ComponentTreeOptions,
  ): Promise<AgentResult<ComponentTreeResult>>

  /**
   * Возвращает компактное состояние компонента по ID.
   * Значения, вышедшие за budget, заменяются TruncatedAgentValue.
   */
  getComponentState(
    componentId: string,
    options?: StateReadOptions,
  ): Promise<AgentResult<ComponentStateResult>>

  /**
   * Повторно читает live state и раскрывает конкретный path.
   * Path начинается с секции: например `['setup', 'rows', 37]`.
   */
  getDetailedState(
    target: StateTarget,
    path: StatePath,
    options?: DetailedStateOptions,
  ): Promise<AgentResult<DetailedStateResult>>

  /** Возвращает краткий список Pinia stores без копирования их state. */
  getPiniaStores(
    options?: PiniaStoresOptions,
  ): Promise<AgentResult<PiniaStoreSummary[]>>

  /** Возвращает budgeted state/getters выбранного Pinia store. */
  getPiniaState(
    storeId: string,
    options?: StateReadOptions,
  ): Promise<AgentResult<PiniaStateResult>>

  /**
   * Возвращает JSON locators корневых DOM-элементов компонента.
   * Нативные Element/Node никогда не возвращаются.
   */
  getComponentDOM(
    componentId: string,
  ): Promise<AgentResult<ComponentDOMResult>>
}

declare global {
  interface Window {
    /** Присутствует только при `vite serve`. */
    AGENT_API?: AgentAPI
  }
}
```

## 2.2. Семантика budget и live reads

- Initial state: `maxDepth = 2`, `maxEntries = 25`, `maxStringLength = 500`.
- Detailed state: `maxDepth = 3`, `limit = 50`, `maxStringLength = 500`.
- `maxEntries` и `limit` не могут превышать 200. Отрицательные значения, `NaN` и превышение hard limit дают `INVALID_OPTIONS`.
- Depth считается от значения, указанного в текущем вызове. Само root value имеет depth 0.
- Для object pagination ключи фиксируются как `Object.keys(value)` в порядке ECMAScript; ответ содержит соответствующую часть ключей.
- Каждый вызов читает актуальное состояние. `revision` увеличивается при известных component/Pinia updates. Без `expectedRevision` страницы могут принадлежать разным состояниям. С `expectedRevision` изменение источника даёт `STALE_REVISION`.
- Неизвестные или выброшенные getter-ошибки становятся `ErrorAgentValue`. `INTERNAL_ERROR` предназначен для ошибки самого адаптера/плагина.

## 2.3. Примеры JSON

### Дерево компонентов

```json
{
  "ok": true,
  "data": {
    "appId": "catalog-app",
    "rootId": "catalog-app:root",
    "format": "nested",
    "nodes": [
      {
        "id": "catalog-app:root",
        "name": "App",
        "parentId": null,
        "depth": 0,
        "hasChildren": true,
        "children": [
          {
            "id": "catalog-app:17",
            "name": "OrdersTable",
            "parentId": "catalog-app:root",
            "depth": 1,
            "hasChildren": true,
            "file": "/src/components/OrdersTable.vue",
            "children": []
          }
        ]
      }
    ],
    "truncatedByDepth": true
  },
  "meta": {
    "requestId": "req_01",
    "revision": 41,
    "observedAt": "2026-07-15T10:00:00.000Z"
  }
}
```

### Состояние с таблицей на 1000 строк

```json
{
  "ok": true,
  "data": {
    "appId": "catalog-app",
    "componentId": "catalog-app:17",
    "name": "OrdersTable",
    "file": "/src/components/OrdersTable.vue",
    "state": {
      "props": {
        "pageSize": 50
      },
      "setup": {
        "selectedId": 1042,
        "rows": {
          "$type": "truncated",
          "kind": "array",
          "path": ["setup", "rows"],
          "total": 1000,
          "returned": 2,
          "preview": [
            { "id": 1000, "status": "paid" },
            { "id": 1001, "status": "pending" }
          ],
          "nextOffset": 2
        }
      },
      "computed": {
        "visibleCount": 50
      },
      "pinia": {
        "orders": {
          "$type": "store-reference",
          "storeId": "orders",
          "appId": "catalog-app"
        }
      }
    }
  },
  "meta": {
    "requestId": "req_02",
    "revision": 41,
    "observedAt": "2026-07-15T10:00:01.000Z"
  }
}
```

### Дозагрузка следующей страницы state

Вызов:

```ts
await window.AGENT_API?.getDetailedState(
  { kind: 'component', componentId: 'catalog-app:17' },
  ['setup', 'rows'],
  { offset: 2, limit: 2, expectedRevision: 41 },
)
```

Ответ:

```json
{
  "ok": true,
  "data": {
    "target": {
      "kind": "component",
      "componentId": "catalog-app:17"
    },
    "path": ["setup", "rows"],
    "value": [
      { "id": 1002, "status": "paid" },
      { "id": 1003, "status": "refunded" }
    ],
    "page": {
      "offset": 2,
      "limit": 2,
      "returned": 2,
      "total": 1000,
      "nextOffset": 4
    }
  },
  "meta": {
    "requestId": "req_03",
    "revision": 41,
    "observedAt": "2026-07-15T10:00:02.000Z"
  }
}
```

Тот же метод применяется к Pinia, например target `{ "kind": "pinia", "storeId": "orders" }` и path `["state", "rows"]`.

### Fragment с несколькими DOM roots

```json
{
  "ok": true,
  "data": {
    "appId": "catalog-app",
    "componentId": "catalog-app:28",
    "roots": [
      {
        "index": 0,
        "selector": "#order-summary",
        "tag": "section",
        "id": "order-summary",
        "classes": ["summary"],
        "text": "Итого: 12 400 ₽",
        "rect": {
          "x": 40,
          "y": 120,
          "width": 600,
          "height": 80,
          "top": 120,
          "right": 640,
          "bottom": 200,
          "left": 40
        },
        "connected": true
      },
      {
        "index": 1,
        "selector": "[data-testid=\"checkout-button\"]",
        "tag": "button",
        "classes": ["primary"],
        "text": "Оплатить",
        "rect": {
          "x": 40,
          "y": 216,
          "width": 180,
          "height": 40,
          "top": 216,
          "right": 220,
          "bottom": 256,
          "left": 40
        },
        "connected": true
      }
    ]
  },
  "meta": {
    "requestId": "req_04",
    "revision": 12,
    "observedAt": "2026-07-15T10:00:03.000Z"
  }
}
```

### Ошибка stale revision

```json
{
  "ok": false,
  "error": {
    "code": "STALE_REVISION",
    "message": "State changed after revision 41",
    "details": {
      "expectedRevision": 41,
      "actualRevision": 42
    }
  },
  "meta": {
    "requestId": "req_05",
    "revision": 42,
    "observedAt": "2026-07-15T10:00:04.000Z"
  }
}
```

# 3. План реализации

## Шаг 1. Ранняя инъекция и `DevtoolsDataSource`

- Реализовать Vite plugin с `apply: 'serve'` и virtual client module, который загружается до entry приложения.
- В клиенте вызвать `devtools.init()`, дождаться `app:init`/replay и публиковать `NOT_READY`, пока нет `AppRecord`.
- За адаптером использовать `devtools.ctx.api.getInspectorTree()` и `getInspectorState()` для inspector IDs `components` и `pinia`.
- Добавить integration fixtures для раннего/позднего hook, отсутствующего Vue, нескольких Vue apps и Pinia без stores.
- Проверить production build: virtual module и строка `AGENT_API` отсутствуют в output.

## Шаг 2. Нормализация и budgeted serialization

- Преобразовать upstream component entries в карты `props/setup/data/computed/attrs/provided/injected/refs`; Pinia-секции заменить `store-reference`.
- Реализовать JSON-safe serializer с отдельной обработкой special values, getter errors и circular references.
- Применять depth/entry/string defaults из `AgentCapabilities`; валидировать hard limit 200.
- Реализовать path resolver по массиву сегментов без dot/JSON Pointer parsing и offset pagination для array/object/string.
- Вести revision по приложению/источнику; при `expectedRevision` выполнять проверку до сериализации.

## Шаг 3. `AgentAPIFacade` и DOM locators

- Опубликовать ровно один frozen `window.AGENT_API`, оборачивающий каждый вызов в `AgentResult<T>` и генерирующий `ResponseMeta`.
- Реализовать nested/flat tree и lazy subtree через `rootId`.
- Для DOM получить все root elements через DevTools tree helper, построить selector с приоритетом уникального `data-testid`, уникального `id`, затем проверенного structural selector.
- Ограничить DOM text 120 символами; для detached/non-element roots вернуть `connected: false` и `selector: null`.
- Не экспортировать raw instance, `Element`, редактирование state, actions или timeline subscriptions.

## Шаг 4. Тесты, документация и подготовка к upstream

- Unit tests: budgets, все special values, cycles, keys с точками/слешами, invalid options, path-not-found и stale revision.
- Vue fixtures: Options API, refs/reactive/computed, getter error, Fragment, Suspense, KeepAlive, anonymous/file-derived names и стабильность runtime ID.
- Pinia fixtures: option/setup stores, getters, custom properties, component store references и пагинация store state.
- DOM tests: multi-root, selector uniqueness, detached nodes, bounding rect и text truncation.
- Contract tests: `JSON.stringify()` каждого success/error ответа, TypeScript declaration test и snapshot примеров из этой спецификации.
- После PoC описать отдельный LLM skill: сначала `listApps/getComponentTree`, затем точечные state/DOM reads, и только после truncation — `getDetailedState`.
- Для upstream PR перенести facade/normalizer/serializer в DevTools, заменив только bootstrap/data-source registration; публичный контракт и contract tests сохранить.

Event log, timeline subscriptions, state mutation и вызов Pinia/component actions намеренно остаются за пределами v1.
