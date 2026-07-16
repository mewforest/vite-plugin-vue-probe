import {
  DevToolsContextHookKeys,
  devtools,
  getActiveInspectors,
} from "@vue/devtools-kit";
import type {
  AppSummary,
  ComponentTreeNode,
  PiniaStoreSummary,
} from "../public-types.js";
import {
  normalizeComponentState,
  normalizePiniaState,
} from "../core/normalizer.js";
import type {
  InspectorComponentPayload,
  InspectorPiniaPayload,
  InspectorStateEntry,
  ProbeDataSource,
  RawComponentTreeResult,
} from "./types.js";
import { DataSourceError } from "./types.js";

export interface BridgeAppRecord {
  id: string;
  name: string;
  version?: string;
  app?: unknown;
  instanceMap?: ReadonlyMap<string, unknown>;
}

export interface DevtoolsBridge {
  init(): void;
  getApps(): BridgeAppRecord[];
  getActiveAppId(): string | undefined;
  toggleApp(appId: string): void;
  hasInspector(inspectorId: "pinia"): boolean;
  getInspectorTree(
    inspectorId: "components" | "pinia",
    filter?: string,
  ): Promise<unknown[]>;
  getInspectorState(
    inspectorId: "components" | "pinia",
    nodeId: string,
  ): Promise<unknown>;
  getComponentRoots(
    appId: string,
    componentId: string,
  ): Element[] | undefined;
  onRevision(callback: (appId?: string) => void): Array<() => void>;
}

const MAX_INSPECTOR_TREE_NODES = 10_000;
const MAX_INSPECTOR_TREE_DEPTH = 1_000;
const MAX_COMPONENT_ROOT_VNODES = 10_000;
const MAX_COMPONENT_ROOT_ELEMENTS = 200;
const MAX_COMPONENT_ROOT_EDGES = 50_000;

function inspectorError(message: string, cause?: unknown): DataSourceError {
  let suffix = "";
  try {
    if (cause instanceof Error && cause.message) suffix = `: ${cause.message}`;
  } catch {
    // Keep the stable operation context for hostile thrown values.
  }
  return new DataSourceError("INTERNAL_ERROR", `${message}${suffix}`);
}

function requiredNodeText(
  node: Record<string, unknown>,
  key: "id" | "name" | "label",
): string | undefined {
  const value = Reflect.get(node, key);
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (key === "id" && typeof value === "number" && Number.isFinite(value))
    return String(value);
  return undefined;
}

function componentTreeFromInspector(value: unknown): ComponentTreeNode[] {
  try {
    if (!Array.isArray(value))
      throw new Error("root payload must be an array");
    if (value.length > MAX_INSPECTOR_TREE_NODES)
      throw new Error(
        `tree contains more than ${MAX_INSPECTOR_TREE_NODES} nodes`,
      );
    const roots: ComponentTreeNode[] = [];
    const seen = new Set<object>();
    const stack: Array<{
      value: unknown;
      parentId: string | null;
      depth: number;
      output: ComponentTreeNode[];
    }> = [];
    for (let index = value.length - 1; index >= 0; index -= 1)
      stack.push({ value: value[index], parentId: null, depth: 0, output: roots });
    let count = 0;
    while (stack.length > 0) {
      const task = stack.pop()!;
      if (task.depth > MAX_INSPECTOR_TREE_DEPTH)
        throw new Error(
          `tree depth exceeds ${MAX_INSPECTOR_TREE_DEPTH}`,
        );
      if (
        typeof task.value !== "object" ||
        task.value === null ||
        Array.isArray(task.value)
      )
        throw new Error("node must be an object");
      if (seen.has(task.value)) throw new Error("tree contains a cycle");
      seen.add(task.value);
      count += 1;
      if (count > MAX_INSPECTOR_TREE_NODES)
        throw new Error(
          `tree contains more than ${MAX_INSPECTOR_TREE_NODES} nodes`,
        );
      const raw = task.value as Record<string, unknown>;
      const id = requiredNodeText(raw, "id");
      const name =
        requiredNodeText(raw, "name") ?? requiredNodeText(raw, "label");
      if (!id || !name) throw new Error("id and name are required");
      const rawChildren = Reflect.get(raw, "children");
      if (rawChildren !== undefined && !Array.isArray(rawChildren))
        throw new Error(`node ${id} children must be an array`);
      const children: ComponentTreeNode[] = [];
      const file = Reflect.get(raw, "file");
      const component: ComponentTreeNode = {
        id,
        name,
        parentId: task.parentId,
        depth: task.depth,
        hasChildren:
          Reflect.get(raw, "hasChildren") === true ||
          Boolean(rawChildren?.length),
        ...(Reflect.get(raw, "inactive") === true ? { inactive: true } : {}),
        ...(Reflect.get(raw, "isFragment") === true
          ? { fragment: true }
          : {}),
        ...(typeof file === "string" ? { file } : {}),
        ...(rawChildren?.length ? { children } : {}),
      };
      task.output.push(component);
      if (
        count + stack.length + (rawChildren?.length ?? 0) >
        MAX_INSPECTOR_TREE_NODES
      )
        throw new Error(
          `tree contains more than ${MAX_INSPECTOR_TREE_NODES} nodes`,
        );
      for (let index = (rawChildren?.length ?? 0) - 1; index >= 0; index -= 1)
        stack.push({
          value: rawChildren![index],
          parentId: id,
          depth: task.depth + 1,
          output: children,
        });
    }
    return roots;
  } catch (error) {
    throw inspectorError("Malformed components inspector tree", error);
  }
}

function findNode(
  nodes: ComponentTreeNode[],
  id: string,
): ComponentTreeNode | undefined {
  const stack = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.id === id) return node;
    if (node.children)
      for (let index = node.children.length - 1; index >= 0; index -= 1)
        stack.push(node.children[index]!);
  }
}

function flattenPiniaNodes(
  nodes: unknown,
  appId: string,
  filter?: string,
): PiniaStoreSummary[] {
  try {
    if (!Array.isArray(nodes)) throw new Error("root payload must be an array");
    if (nodes.length > MAX_INSPECTOR_TREE_NODES)
      throw new Error(
        `tree contains more than ${MAX_INSPECTOR_TREE_NODES} nodes`,
      );
    const result: PiniaStoreSummary[] = [];
    const normalizedFilter = filter?.toLowerCase();
    const seen = new Set<object>();
    const stack: Array<{ value: unknown; depth: number }> = [];
    for (let index = nodes.length - 1; index >= 0; index -= 1)
      stack.push({ value: nodes[index], depth: 0 });
    let count = 0;
    while (stack.length > 0) {
      const task = stack.pop()!;
      if (task.depth > MAX_INSPECTOR_TREE_DEPTH)
        throw new Error(
          `tree depth exceeds ${MAX_INSPECTOR_TREE_DEPTH}`,
        );
      if (
        typeof task.value !== "object" ||
        task.value === null ||
        Array.isArray(task.value)
      )
        throw new Error("node must be an object");
      if (seen.has(task.value)) throw new Error("tree contains a cycle");
      seen.add(task.value);
      count += 1;
      if (count > MAX_INSPECTOR_TREE_NODES)
        throw new Error(
          `tree contains more than ${MAX_INSPECTOR_TREE_NODES} nodes`,
        );
      const node = task.value as Record<string, unknown>;
      const id = requiredNodeText(node, "id");
      const label =
        requiredNodeText(node, "label") ?? requiredNodeText(node, "name");
      if (!id || !label) throw new Error("id and label are required");
      if (
        !normalizedFilter ||
        `${id} ${label}`.toLowerCase().includes(normalizedFilter)
      )
        result.push({ appId, id });
      const children = Reflect.get(node, "children");
      if (children !== undefined && !Array.isArray(children))
        throw new Error(`node ${id} children must be an array`);
      if (
        count + stack.length + (children?.length ?? 0) >
        MAX_INSPECTOR_TREE_NODES
      )
        throw new Error(
          `tree contains more than ${MAX_INSPECTOR_TREE_NODES} nodes`,
        );
      for (let index = (children?.length ?? 0) - 1; index >= 0; index -= 1)
        stack.push({ value: children![index], depth: task.depth + 1 });
    }
    return result;
  } catch (error) {
    throw inspectorError("Malformed Pinia inspector tree", error);
  }
}

function validateEntries(
  value: unknown,
  context: string,
): InspectorStateEntry[] {
  if (!Array.isArray(value))
    throw inspectorError(`${context}: state entries must be an array`);
  for (const entry of value) {
    try {
      if (
        typeof entry !== "object" ||
        entry === null ||
        Array.isArray(entry) ||
        typeof Reflect.get(entry, "key") !== "string"
      )
        throw inspectorError(`${context}: every state entry requires a key`);
    } catch (error) {
      if (error instanceof DataSourceError) throw error;
      throw inspectorError(`${context}: malformed state entry`, error);
    }
  }
  return value as InspectorStateEntry[];
}

function componentPayload(
  value: unknown,
  componentId: string,
): InspectorComponentPayload {
  if (value === null || value === undefined)
    throw new DataSourceError(
      "COMPONENT_NOT_FOUND",
      `Component not found: ${componentId}`,
    );
  try {
    if (typeof value !== "object" || Array.isArray(value))
      throw inspectorError("Malformed components inspector state");
    const payload = value as Record<string, unknown>;
    const id = requiredNodeText(payload, "id");
    const name = requiredNodeText(payload, "name");
    if (!id || !name)
      throw inspectorError(
        "Malformed components inspector state: id and name are required",
      );
    const file = Reflect.get(payload, "file");
    return {
      id,
      name,
      ...(typeof file === "string" ? { file } : {}),
      state: validateEntries(
        Reflect.get(payload, "state"),
        `Malformed components inspector state for ${id}`,
      ),
    };
  } catch (error) {
    if (error instanceof DataSourceError) throw error;
    throw inspectorError("Malformed components inspector state", error);
  }
}

function piniaPayload(value: unknown, storeId: string): InspectorPiniaPayload {
  if (value === null || value === undefined)
    throw new DataSourceError(
      "STORE_NOT_FOUND",
      `Pinia store not found: ${storeId}`,
    );
  try {
    if (typeof value !== "object" || Array.isArray(value))
      throw inspectorError(`Malformed Pinia inspector state for ${storeId}`);
    if (Object.keys(value).length === 0)
      throw new DataSourceError(
        "STORE_NOT_FOUND",
        `Pinia store not found: ${storeId}`,
      );
    const payload = value as Record<string, unknown>;
    const result: InspectorPiniaPayload = {};
    for (const section of [
      "state",
      "getters",
      "custom properties",
      "customProperties",
    ]) {
      if (!Object.hasOwn(payload, section)) continue;
      result[section] = validateEntries(
        Reflect.get(payload, section),
        `Malformed Pinia inspector state for ${storeId}.${section}`,
      );
    }
    return result;
  } catch (error) {
    if (error instanceof DataSourceError) throw error;
    throw inspectorError(`Malformed Pinia inspector state for ${storeId}`, error);
  }
}

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const result = new Array<U>(values.length);
  let nextIndex = 0;
  let failed = false;
  let firstError: unknown;
  const worker = async (): Promise<void> => {
    while (!failed && nextIndex < values.length) {
      const index = nextIndex++;
      try {
        result[index] = await mapper(values[index]!);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  };
  await Promise.allSettled(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  if (failed) throw firstError;
  return result;
}

export class DevtoolsDataSource implements ProbeDataSource {
  private readonly revisions = new Map<string, number>();
  private operationTail: Promise<void> = Promise.resolve();
  private initialized = false;
  private stopRevisions: Array<() => void> | undefined;

  constructor(private readonly bridge: DevtoolsBridge = createKitBridge()) {}

  init(): void {
    if (this.stopRevisions) return;
    if (!this.initialized) {
      this.bridge.init();
      this.initialized = true;
    }
    this.stopRevisions = this.bridge.onRevision((appId) => {
      if (appId) {
        this.revisions.set(appId, this.getRevision(appId) + 1);
        return;
      }
      for (const app of this.bridge.getApps())
        this.revisions.set(app.id, this.getRevision(app.id) + 1);
    });
  }

  dispose(): void {
    const disposers = this.stopRevisions;
    if (!disposers) return;
    this.stopRevisions = undefined;
    let failed = false;
    let firstError: unknown;
    for (const dispose of disposers) {
      try {
        dispose();
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
    if (failed) throw firstError;
  }

  listApps(): AppSummary[] {
    const apps = this.bridge.getApps();
    const liveIds = new Set(apps.map((app) => app.id));
    for (const id of this.revisions.keys())
      if (!liveIds.has(id)) this.revisions.delete(id);
    const active = this.getActiveAppId();
    return apps.map((app) => ({
      id: app.id,
      name: app.name,
      vueVersion: app.version ?? "unknown",
      active: app.id === active,
      ...(app.instanceMap ? { componentCount: app.instanceMap.size } : {}),
    }));
  }

  getActiveAppId(): string | undefined {
    return this.bridge.getActiveAppId();
  }

  hasApp(appId: string): boolean {
    return this.bridge.getApps().some((app) => app.id === appId);
  }

  getRevision(appId?: string): number {
    const id = appId ?? this.getActiveAppId();
    if (!id) return 0;
    if (!this.bridge.getApps().some((app) => app.id === id)) {
      this.revisions.delete(id);
      return 0;
    }
    return this.revisions.get(id) ?? 0;
  }

  private assertApp(appId: string): void {
    if (!this.hasApp(appId))
      throw new DataSourceError("APP_NOT_FOUND", `Vue app not found: ${appId}`);
  }

  private selectApp(appId: string): void {
    this.assertApp(appId);
    if (this.getActiveAppId() !== appId) this.bridge.toggleApp(appId);
  }

  private assertSelectedApp(appId: string, context: string): void {
    const activeAppId = this.getActiveAppId();
    if (activeAppId !== appId)
      throw inspectorError(
        `${context}: active app changed from ${appId} to ${activeAppId ?? "none"}`,
      );
  }

  private withSelectedApp<T>(
    appId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const previousAppId = this.getActiveAppId();
      let result!: T;
      let failed = false;
      let firstError: unknown;
      try {
        this.selectApp(appId);
        result = await operation();
      } catch (error) {
        failed = true;
        firstError = error;
      }
      try {
        if (
          previousAppId &&
          previousAppId !== appId &&
          this.getActiveAppId() === appId &&
          this.bridge.getApps().some((app) => app.id === previousAppId)
        )
          this.bridge.toggleApp(previousAppId);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
      if (failed) throw firstError;
      return result;
    };
    const result = this.operationTail.then(run, run);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  hasPiniaInspector(appId: string): Promise<boolean> {
    return this.withSelectedApp(appId, async () =>
      this.bridge.hasInspector("pinia"),
    );
  }

  getComponentTree(
    appId: string,
    filter = "",
    rootId?: string,
  ): Promise<RawComponentTreeResult> {
    return this.withSelectedApp(appId, async () => {
      const raw = await this.bridge.getInspectorTree("components", filter);
      const roots = componentTreeFromInspector(raw);
      const selected = rootId ? findNode(roots, rootId) : undefined;
      if (rootId && !selected)
        throw new DataSourceError(
          "COMPONENT_NOT_FOUND",
          `Component not found: ${rootId}`,
        );
      return {
        appId,
        rootId: rootId ?? roots[0]?.id ?? `${appId}:root`,
        nodes: selected ? [selected] : roots,
      };
    });
  }

  getComponentState(appId: string, componentId: string) {
    return this.withSelectedApp(appId, async () => {
      const payload = componentPayload(
        await this.bridge.getInspectorState("components", componentId),
        componentId,
      );
      try {
        return normalizeComponentState(payload, appId);
      } catch (error) {
        if (error instanceof DataSourceError) throw error;
        throw inspectorError(
          `Malformed components inspector state for ${componentId}`,
          error,
        );
      }
    });
  }

  getPiniaStores(
    appId: string,
    filter = "",
    includeKeys = false,
  ): Promise<PiniaStoreSummary[]> {
    return this.withSelectedApp(appId, async () => {
      if (!this.bridge.hasInspector("pinia")) return [];
      let tree: unknown[];
      try {
        tree = await this.bridge.getInspectorTree("pinia", filter);
      } catch (error) {
        throw inspectorError("Pinia inspector tree read failed", error);
      }
      const stores = flattenPiniaNodes(tree, appId, filter);
      if (!includeKeys) return stores;
      this.assertSelectedApp(appId, "Pinia key enrichment aborted");
      return mapWithConcurrency(stores, 4, async (store) => {
        try {
          this.assertSelectedApp(
            appId,
            `Pinia state read aborted for ${store.id}`,
          );
          const raw = normalizePiniaState(
            piniaPayload(
              await this.bridge.getInspectorState("pinia", store.id),
              store.id,
            ),
            appId,
            store.id,
          );
          return {
            ...store,
            stateKeys: Object.keys(raw.state),
            getterKeys: Object.keys(raw.getters ?? {}),
          };
        } catch (error) {
          if (error instanceof DataSourceError && error.code === "INTERNAL_ERROR")
            throw error;
          throw inspectorError(
            `Pinia inspector state read failed for ${store.id}`,
            error,
          );
        }
      });
    });
  }

  getPiniaState(appId: string, storeId: string) {
    return this.withSelectedApp(appId, async () => {
      const payload = piniaPayload(
        await this.bridge.getInspectorState("pinia", storeId),
        storeId,
      );
      try {
        return normalizePiniaState(payload, appId, storeId);
      } catch (error) {
        if (error instanceof DataSourceError) throw error;
        throw inspectorError(
          `Malformed Pinia inspector state for ${storeId}`,
          error,
        );
      }
    });
  }

  getComponentRoots(appId: string, componentId: string): Element[] {
    this.assertApp(appId);
    if (typeof componentId !== "string" || componentId.trim().length === 0)
      throw new DataSourceError(
        "COMPONENT_NOT_FOUND",
        "Component id must be a non-empty string",
      );
    const roots = this.bridge.getComponentRoots(appId, componentId);
    if (!roots)
      throw new DataSourceError(
        "COMPONENT_NOT_FOUND",
        `Component not found: ${componentId}`,
      );
    return roots;
  }
}

export function collectComponentRootElements(value: unknown): Element[] {
  const output: Element[] = [];
  const scheduled = new WeakSet<object>();
  const stack: object[] = [];
  let visitedVNodes = 0;
  let visitedEdges = 0;
  const reserve = (candidate: unknown, next: object[]): void => {
    if (typeof candidate !== "object" || candidate === null) return;
    if (scheduled.has(candidate)) return;
    scheduled.add(candidate);
    next.push(candidate);
  };
  const reserveEdge = (candidate: unknown, next: object[]): void => {
    if (candidate === undefined || candidate === null) return;
    visitedEdges += 1;
    if (visitedEdges > MAX_COMPONENT_ROOT_EDGES)
      throw new DataSourceError(
        "INTERNAL_ERROR",
        `Component root traversal exceeds ${MAX_COMPONENT_ROOT_EDGES} VNode edges`,
      );
    reserve(candidate, next);
  };
  reserve(value, stack);
  try {
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (typeof Element !== "undefined" && current instanceof Element) {
        output.push(current);
        if (output.length > MAX_COMPONENT_ROOT_ELEMENTS)
          throw new DataSourceError(
            "INTERNAL_ERROR",
            `Component exposes more than ${MAX_COMPONENT_ROOT_ELEMENTS} DOM roots`,
          );
        continue;
      }
      visitedVNodes += 1;
      if (visitedVNodes > MAX_COMPONENT_ROOT_VNODES)
        throw new DataSourceError(
          "INTERNAL_ERROR",
          `Component root traversal exceeds ${MAX_COMPONENT_ROOT_VNODES} VNode objects`,
        );

      // Vue's public VNode type omits several Suspense/fragment branches used
      // by DevTools, so traversal stays deliberately structural and bounded.
      const record = current as Record<string, unknown>;
      const component = Reflect.get(record, "component");
      const children = Reflect.get(record, "children");
      const next: object[] = [];
      if (component && typeof component === "object")
        reserveEdge(Reflect.get(component, "subTree"), next);
      reserveEdge(Reflect.get(record, "el"), next);
      reserveEdge(Reflect.get(record, "activeBranch"), next);
      if (Array.isArray(children)) {
        for (let index = 0; index < children.length; index += 1) {
          const child = children[index];
          visitedEdges += 1;
          if (visitedEdges > MAX_COMPONENT_ROOT_EDGES)
            throw new DataSourceError(
              "INTERNAL_ERROR",
              `Component root traversal exceeds ${MAX_COMPONENT_ROOT_EDGES} VNode edges`,
            );
          reserve(child, next);
        }
      }
      for (let index = next.length - 1; index >= 0; index -= 1)
        stack.push(next[index]!);
    }
    return output;
  } catch (error) {
    let isDataSourceError = false;
    try {
      isDataSourceError = error instanceof DataSourceError;
    } catch {
      // A hostile thrown proxy is wrapped by the stable inspector boundary.
    }
    if (isDataSourceError) throw error;
    throw inspectorError("Component root traversal failed", error);
  }
}

export function createKitBridge(): DevtoolsBridge {
  const appIdFor = (app: unknown): string | undefined =>
    devtools.ctx.state.appRecords.find((record) => record.app === app)?.id;

  const bridge = {
    init: () => devtools.init(),
    getApps: () => devtools.ctx.state.appRecords,
    getActiveAppId: () => devtools.ctx.state.activeAppRecordId || undefined,
    toggleApp: (appId: string) => devtools.api.toggleApp(appId),
    hasInspector: (inspectorId: "pinia") =>
      getActiveInspectors().some((inspector) => inspector.id === inspectorId),
    getInspectorTree: (
      inspectorId: "components" | "pinia",
      filter = "",
    ) => devtools.api.getInspectorTree({ inspectorId, filter }),
    getInspectorState: (
      inspectorId: "components" | "pinia",
      nodeId: string,
    ) => devtools.api.getInspectorState({ inspectorId, nodeId }),
    getComponentRoots: (appId: string, componentId: string) => {
      const app = devtools.ctx.state.appRecords.find(
        (record) => record.id === appId,
      );
      const instance = app?.instanceMap.get(componentId);
      if (!instance) return undefined;
      return collectComponentRootElements(instance.subTree);
    },
    onRevision: (callback: (appId?: string) => void) => {
      const emitRevisionFor = (app: unknown): void => {
        callback(appIdFor(app));
      };
      const disposers: Array<() => void> = [];
      try {
        disposers.push(devtools.hook.on.componentAdded(emitRevisionFor));
        disposers.push(devtools.hook.on.componentUpdated(emitRevisionFor));
        disposers.push(devtools.hook.on.componentRemoved(emitRevisionFor));
        disposers.push(
          devtools.ctx.hooks.hook(
            DevToolsContextHookKeys.SEND_INSPECTOR_STATE,
            (payload) => {
              if (payload.inspectorId === "pinia")
                emitRevisionFor(payload.plugin.descriptor.app);
            },
          ),
        );
      } catch (registrationError) {
        for (let index = disposers.length - 1; index >= 0; index -= 1) {
          try {
            disposers[index]!();
          } catch {
            // Preserve the registration error while draining every rollback.
          }
        }
        throw registrationError;
      }
      return disposers;
    },
  } satisfies DevtoolsBridge;

  return bridge;
}
