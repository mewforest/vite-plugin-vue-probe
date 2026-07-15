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
  details?: Record<string, JsonPrimitive | StatePath>
}

export interface ResponseMeta {
  requestId: string
  revision: number
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

export interface UndefinedAgentValue { $type: 'undefined' }
export interface NonFiniteNumberAgentValue { $type: 'number', value: 'NaN' | 'Infinity' | '-Infinity' }
export interface BigIntAgentValue { $type: 'bigint', value: string }
export interface DateAgentValue { $type: 'date', value: string }
export interface MapAgentValue { $type: 'map', size: number, entries: Array<[AgentValue, AgentValue]> }
export interface SetAgentValue { $type: 'set', size: number, values: AgentValue[] }
export interface ErrorAgentValue { $type: 'error', name: string, message: string }
export interface CircularReferenceAgentValue { $type: 'circular-reference', targetPath: StatePath }
export interface StoreReferenceAgentValue { $type: 'store-reference', storeId: string, appId?: string }

export type TruncatedKind = 'array' | 'object' | 'string'

export interface TruncatedAgentValue {
  $type: 'truncated'
  kind: TruncatedKind
  path: StatePath
  total: number
  returned: number
  preview: AgentValue
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

export type AgentValue = JsonPrimitive | AgentSpecialValue | AgentValue[] | { [key: string]: AgentValue }

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
  appId?: string
  rootId?: string
  filter?: string
  format?: ComponentTreeFormat
  maxDepth?: number | null
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
  maxDepth?: number
  maxEntries?: number
  maxStringLength?: number
}

export interface StateReadOptions extends SerializationBudget {
  appId?: string
  expectedRevision?: number
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

export type ComponentStateSections = Partial<Record<ComponentStateSection, Record<string, AgentValue>>>

export interface StateEntryMetadata {
  reactivity?: 'ref' | 'reactive' | 'computed' | 'plain'
  readonly?: boolean
  propType?: string
  required?: boolean
}

export type ComponentStateMetadata = Partial<Record<ComponentStateSection, Record<string, StateEntryMetadata>>>

export interface ComponentStateResult {
  appId: string
  componentId: string
  name: string
  file?: string
  state: ComponentStateSections
  metadata?: ComponentStateMetadata
}

export type StateTarget =
  | { kind: 'component', componentId: string, appId?: string }
  | { kind: 'pinia', storeId: string, appId?: string }

export interface DetailedStateOptions extends SerializationBudget {
  offset?: number
  limit?: number
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
  page?: StatePage
}

export interface PiniaStoresOptions { appId?: string, filter?: string }

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
  index: number
  selector: string | null
  tag: string
  id?: string
  classes?: string[]
  text?: string
  rect: DOMRectJSON
  connected: boolean
}

export interface ComponentDOMResult { appId: string, componentId: string, roots: DOMNodeLocator[] }

export interface AgentAPI {
  readonly version: string
  getCapabilities(): Promise<AgentResult<AgentCapabilities>>
  listApps(): Promise<AgentResult<AppSummary[]>>
  getComponentTree(options?: ComponentTreeOptions): Promise<AgentResult<ComponentTreeResult>>
  getComponentState(componentId: string, options?: StateReadOptions): Promise<AgentResult<ComponentStateResult>>
  getDetailedState(target: StateTarget, path: StatePath, options?: DetailedStateOptions): Promise<AgentResult<DetailedStateResult>>
  getPiniaStores(options?: PiniaStoresOptions): Promise<AgentResult<PiniaStoreSummary[]>>
  getPiniaState(storeId: string, options?: StateReadOptions): Promise<AgentResult<PiniaStateResult>>
  getComponentDOM(componentId: string): Promise<AgentResult<ComponentDOMResult>>
}

declare global {
  interface Window {
    AGENT_API?: AgentAPI
  }
}
