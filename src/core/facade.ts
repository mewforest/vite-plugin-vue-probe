import type {
  AgentAPI,
  AgentCapabilities,
  AgentError,
  AgentResult,
  AgentValue,
  AppSummary,
  ComponentStateResult,
  ComponentTreeNode,
  ComponentTreeOptions,
  DetailedStateOptions,
  PiniaStateResult,
  ResponseMeta,
  SerializationBudget,
  StateReadOptions,
  StateTarget,
} from '../public-types'
import type { AgentDataSource, RawComponentState, RawPiniaState, RawStateMap } from '../data-source/types'
import { DataSourceError } from '../data-source/types'
import { createDOMLocators } from './dom'
import { AgentOptionsError, AgentPathError, resolveDetailedValue } from './path'
import { INITIAL_SERIALIZATION_DEFAULTS, serializeAgentValue } from './serializer'

export const AGENT_API_VERSION = '0.1.0'

const CAPABILITIES: AgentCapabilities = {
  apiVersion: AGENT_API_VERSION,
  vueDetected: false,
  piniaDetected: false,
  multipleApps: false,
  componentTree: true,
  componentState: true,
  detailedState: true,
  piniaState: false,
  componentDOM: true,
  stateMutation: false,
  eventTimeline: false,
  defaults: {
    maxDepth: 2,
    maxEntries: 25,
    maxStringLength: 500,
    detailMaxDepth: 3,
    detailPageSize: 50,
    hardMaxEntries: 200,
  },
}

function stateBudget(options: SerializationBudget = {}) {
  return {
    maxDepth: options.maxDepth ?? INITIAL_SERIALIZATION_DEFAULTS.maxDepth,
    maxEntries: options.maxEntries ?? INITIAL_SERIALIZATION_DEFAULTS.maxEntries,
    maxStringLength: options.maxStringLength ?? INITIAL_SERIALIZATION_DEFAULTS.maxStringLength,
  }
}

function serializeMap(map: RawStateMap | undefined, prefix: string, budget: ReturnType<typeof stateBudget>): Record<string, AgentValue> | undefined {
  if (!map)
    return undefined
  const result: Record<string, AgentValue> = Object.create(null) as Record<string, AgentValue>
  for (const key of Object.keys(map)) {
    try {
      result[key] = serializeAgentValue(Reflect.get(map, key), { ...budget, path: [prefix, key] })
    }
    catch (error) {
      result[key] = serializeAgentValue(error)
    }
  }
  return result
}

function componentResult(raw: RawComponentState, options: StateReadOptions): ComponentStateResult {
  const budget = stateBudget(options)
  serializeAgentValue(null, budget)
  const state: ComponentStateResult['state'] = {}
  for (const section of Object.keys(raw.state) as Array<keyof RawComponentState['state']>) {
    const serialized = serializeMap(raw.state[section], section, budget)
    if (serialized)
      state[section] = serialized
  }
  return {
    appId: raw.appId,
    componentId: raw.componentId,
    name: raw.name,
    ...(raw.file ? { file: raw.file } : {}),
    state,
    ...(options.includeMetadata && raw.metadata ? { metadata: raw.metadata } : {}),
  }
}

function piniaResult(raw: RawPiniaState, options: StateReadOptions): PiniaStateResult {
  const budget = stateBudget(options)
  serializeAgentValue(null, budget)
  const getters = serializeMap(raw.getters, 'getters', budget)
  const customProperties = serializeMap(raw.customProperties, 'customProperties', budget)
  return {
    appId: raw.appId,
    storeId: raw.storeId,
    state: serializeMap(raw.state, 'state', budget) ?? {},
    ...(getters ? { getters } : {}),
    ...(customProperties ? { customProperties } : {}),
  }
}

function pruneTree(nodes: ComponentTreeNode[], maxDepth: number | null, includeFile: boolean): { nodes: ComponentTreeNode[], truncated: boolean } {
  let truncated = false
  const visit = (node: ComponentTreeNode, baseDepth: number): ComponentTreeNode => {
    const relativeDepth = node.depth - baseDepth
    const over = maxDepth !== null && relativeDepth >= maxDepth && Boolean(node.children?.length)
    if (over)
      truncated = true
    const children = over ? undefined : node.children?.map(child => visit(child, baseDepth))
    const { children: _children, file, ...rest } = node
    return {
      ...rest,
      depth: relativeDepth,
      ...(includeFile && file ? { file } : {}),
      ...(children?.length ? { children } : {}),
    }
  }
  const baseDepth = nodes[0]?.depth ?? 0
  return { nodes: nodes.map(node => visit(node, baseDepth)), truncated }
}

function flatTree(nodes: ComponentTreeNode[]): ComponentTreeNode[] {
  const result: ComponentTreeNode[] = []
  const visit = (node: ComponentTreeNode) => {
    const { children, ...flat } = node
    result.push(flat)
    children?.forEach(visit)
  }
  nodes.forEach(visit)
  return result
}

function contractError(error: unknown): AgentError {
  if (error instanceof DataSourceError || error instanceof AgentPathError || error instanceof AgentOptionsError)
    return { code: error.code, message: error.message }
  const message = error instanceof Error ? error.message : String(error)
  return { code: 'INTERNAL_ERROR', message }
}

export function createAgentAPI(source: AgentDataSource): AgentAPI {
  let requestSequence = 0
  const meta = (appId?: string): ResponseMeta => ({
    requestId: `agent-${++requestSequence}`,
    revision: source.getRevision(appId),
    observedAt: new Date().toISOString(),
  })
  const appId = (requested?: string): string => {
    const id = requested ?? source.getActiveAppId()
    if (!id)
      throw new DataSourceError('NOT_READY', 'No Vue application has been detected')
    return id
  }
  const staleCheck = (id: string, expected?: number) => {
    const actual = source.getRevision(id)
    if (expected !== undefined && expected !== actual)
      throw new DataSourceError('STALE_REVISION', `Expected revision ${expected}, observed ${actual}`)
  }
  const run = async <T>(operation: () => Promise<T> | T): Promise<AgentResult<T>> => {
    try {
      return { ok: true, data: await operation(), meta: meta(source.getActiveAppId()) }
    }
    catch (error) {
      return { ok: false, error: contractError(error), meta: meta(source.getActiveAppId()) }
    }
  }
  const runForApp = async <T>(requestedAppId: string | undefined, operation: (id: string) => Promise<T> | T): Promise<AgentResult<T>> => {
    let selectedAppId: string | undefined
    try {
      selectedAppId = appId(requestedAppId)
      return { ok: true, data: await operation(selectedAppId), meta: meta(selectedAppId) }
    }
    catch (error) {
      return { ok: false, error: contractError(error), meta: meta(selectedAppId) }
    }
  }

  return {
    version: AGENT_API_VERSION,
    getCapabilities: () => run(async () => {
      const apps = source.listApps()
      const id = source.getActiveAppId()
      const pinia = id ? (await source.getPiniaStores(id)).length > 0 : false
      return { ...CAPABILITIES, vueDetected: apps.length > 0, piniaDetected: pinia, piniaState: pinia, multipleApps: apps.length > 1 }
    }),
    listApps: () => run<AppSummary[]>(() => source.listApps()),
    getComponentTree: (options: ComponentTreeOptions = {}) => runForApp(options.appId, async (id) => {
        if (options.maxDepth !== undefined && options.maxDepth !== null && (!Number.isInteger(options.maxDepth) || options.maxDepth < 0))
          throw new AgentOptionsError('maxDepth must be a non-negative integer or null')
        const raw = await source.getComponentTree(id, options.filter, options.rootId)
        const format = options.format ?? 'nested'
        const pruned = pruneTree(raw.nodes, options.maxDepth ?? null, options.includeFile ?? false)
        return {
          appId: id,
          rootId: raw.rootId,
          format,
          nodes: format === 'flat' ? flatTree(pruned.nodes) : pruned.nodes,
          truncatedByDepth: pruned.truncated,
        }
      }),
    getComponentState: (componentId, options: StateReadOptions = {}) => runForApp(options.appId, async (id) => {
        staleCheck(id, options.expectedRevision)
        return componentResult(await source.getComponentState(id, componentId), options)
      }),
    getDetailedState: (target: StateTarget, path, options: DetailedStateOptions = {}) => runForApp(target.appId, async (id) => {
        staleCheck(id, options.expectedRevision)
        const raw = target.kind === 'component'
          ? (await source.getComponentState(id, target.componentId)).state
          : await source.getPiniaState(id, target.storeId)
        return { target, ...resolveDetailedValue(raw, path, options) }
      }),
    getPiniaStores: (options = {}) => runForApp(options.appId, id => source.getPiniaStores(id, options.filter)),
    getPiniaState: (storeId, options: StateReadOptions = {}) => runForApp(options.appId, async (id) => {
        staleCheck(id, options.expectedRevision)
        return piniaResult(await source.getPiniaState(id, storeId), options)
      }),
    getComponentDOM: (componentId) => runForApp(undefined, (id) => {
      return { appId: id, componentId, roots: createDOMLocators(source.getComponentRoots(id, componentId)) }
    }),
  }
}
