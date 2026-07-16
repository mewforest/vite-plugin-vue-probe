import { devtools } from "@vue/devtools-kit";
import type {
  AppSummary,
  ComponentTreeNode,
  PiniaStoreSummary,
} from "../public-types";
import {
  normalizeComponentState,
  normalizePiniaState,
} from "../core/normalizer";
import type {
  ProbeDataSource,
  InspectorComponentPayload,
  InspectorPiniaPayload,
  RawComponentTreeResult,
} from "./types";
import { DataSourceError } from "./types";

export interface BridgeAppRecord {
  id: string;
  name: string;
  version?: string;
  instanceMap?: Map<string, unknown>;
}

export interface DevtoolsBridge {
  init(): void;
  getApps(): BridgeAppRecord[];
  getActiveAppId(): string | undefined;
  toggleApp(appId: string): void;
  getInspectorTree(
    inspectorId: "components" | "pinia",
    filter?: string,
  ): Promise<unknown[]>;
  getInspectorState(
    inspectorId: "components" | "pinia",
    nodeId: string,
  ): Promise<unknown>;
  getComponentRoots(appId: string, componentId: string): Element[];
  onRevision(callback: (appId?: string) => void): void;
}

function nodeFromInspector(
  node: Record<string, unknown>,
  parentId: string | null,
  depth: number,
): ComponentTreeNode {
  const children = Array.isArray(node.children)
    ? node.children.map((child) =>
        nodeFromInspector(
          child as Record<string, unknown>,
          String(node.id),
          depth + 1,
        ),
      )
    : [];
  return {
    id: String(node.id),
    name: String(node.name ?? node.label ?? "Anonymous"),
    parentId,
    depth,
    hasChildren: Boolean(node.hasChildren ?? children.length),
    ...(node.inactive ? { inactive: true } : {}),
    ...(node.isFragment ? { fragment: true } : {}),
    ...(typeof node.file === "string" ? { file: node.file } : {}),
    ...(children.length ? { children } : {}),
  };
}

function findNode(
  nodes: ComponentTreeNode[],
  id: string,
): ComponentTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = node.children && findNode(node.children, id);
    if (found) return found;
  }
}

function flattenPiniaNodes(
  nodes: unknown[],
  appId: string,
  filter?: string,
): PiniaStoreSummary[] {
  const result: PiniaStoreSummary[] = [];
  const visit = (node: Record<string, unknown>) => {
    const id = String(node.id);
    const label = String(node.label ?? id);
    if (
      !filter ||
      `${id} ${label}`.toLowerCase().includes(filter.toLowerCase())
    )
      result.push({ appId, id, stateKeys: [], getterKeys: [] });
    if (Array.isArray(node.children))
      node.children.forEach((child) => visit(child as Record<string, unknown>));
  };
  nodes.forEach((node) => visit(node as Record<string, unknown>));
  return result;
}

export class DevtoolsDataSource implements ProbeDataSource {
  private readonly revisions = new Map<string, number>();

  constructor(private readonly bridge: DevtoolsBridge = createKitBridge()) {}

  init(): void {
    this.bridge.onRevision((appId) => {
      const id = appId ?? this.getActiveAppId();
      if (id) this.revisions.set(id, this.getRevision(id) + 1);
    });
    this.bridge.init();
  }

  listApps(): AppSummary[] {
    const active = this.getActiveAppId();
    return this.bridge.getApps().map((app) => ({
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

  getRevision(appId?: string): number {
    const id = appId ?? this.getActiveAppId();
    return id ? (this.revisions.get(id) ?? 0) : 0;
  }

  private selectApp(appId: string): void {
    if (!this.bridge.getApps().some((app) => app.id === appId))
      throw new DataSourceError("APP_NOT_FOUND", `Vue app not found: ${appId}`);
    if (this.getActiveAppId() !== appId) this.bridge.toggleApp(appId);
  }

  async getComponentTree(
    appId: string,
    filter = "",
    rootId?: string,
  ): Promise<RawComponentTreeResult> {
    this.selectApp(appId);
    const raw = await this.bridge.getInspectorTree("components", filter);
    const roots = raw.map((node) =>
      nodeFromInspector(node as Record<string, unknown>, null, 0),
    );
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
  }

  async getComponentState(appId: string, componentId: string) {
    this.selectApp(appId);
    const payload = await this.bridge.getInspectorState(
      "components",
      componentId,
    );
    if (
      !payload ||
      typeof payload !== "object" ||
      !Array.isArray((payload as InspectorComponentPayload).state)
    )
      throw new DataSourceError(
        "COMPONENT_NOT_FOUND",
        `Component not found: ${componentId}`,
      );
    return normalizeComponentState(payload as InspectorComponentPayload, appId);
  }

  async getPiniaStores(
    appId: string,
    filter = "",
  ): Promise<PiniaStoreSummary[]> {
    this.selectApp(appId);
    try {
      const stores = flattenPiniaNodes(
        await this.bridge.getInspectorTree("pinia", filter),
        appId,
        filter,
      );
      return await Promise.all(
        stores.map(async (store) => {
          try {
            const raw = normalizePiniaState(
              (await this.bridge.getInspectorState(
                "pinia",
                store.id,
              )) as InspectorPiniaPayload,
              appId,
              store.id,
            );
            return {
              ...store,
              stateKeys: Object.keys(raw.state),
              getterKeys: Object.keys(raw.getters ?? {}),
            };
          } catch {
            return store;
          }
        }),
      );
    } catch {
      return [];
    }
  }

  async getPiniaState(appId: string, storeId: string) {
    this.selectApp(appId);
    const payload = await this.bridge.getInspectorState("pinia", storeId);
    if (
      !payload ||
      typeof payload !== "object" ||
      Object.keys(payload).length === 0
    )
      throw new DataSourceError(
        "STORE_NOT_FOUND",
        `Pinia store not found: ${storeId}`,
      );
    return normalizePiniaState(
      payload as InspectorPiniaPayload,
      appId,
      storeId,
    );
  }

  getComponentRoots(appId: string, componentId: string): Element[] {
    this.selectApp(appId);
    return this.bridge.getComponentRoots(appId, componentId);
  }
}

function collectElements(
  value: unknown,
  output: Element[],
  seen: Set<unknown>,
): void {
  if (!value || seen.has(value)) return;
  seen.add(value);
  if (typeof Element !== "undefined" && value instanceof Element) {
    output.push(value);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.component && typeof record.component === "object")
    collectElements(
      (record.component as Record<string, unknown>).subTree,
      output,
      seen,
    );
  if (record.el) collectElements(record.el, output, seen);
  if (record.activeBranch) collectElements(record.activeBranch, output, seen);
  if (Array.isArray(record.children))
    record.children.forEach((child) => collectElements(child, output, seen));
}

export function createKitBridge(): DevtoolsBridge {
  const kit = devtools as unknown as {
    init(): void;
    ctx: {
      state: { appRecords: BridgeAppRecord[]; activeAppRecordId?: string };
    };
    api: {
      toggleApp(id: string): void;
      getInspectorTree(payload: {
        inspectorId: string;
        filter: string;
      }): Promise<unknown[]>;
      getInspectorState(payload: {
        inspectorId: string;
        nodeId: string;
      }): Promise<unknown>;
    };
    hook: {
      on: Record<string, (callback: (...args: unknown[]) => void) => void>;
    };
  };
  return {
    init: () => kit.init(),
    getApps: () => kit.ctx.state.appRecords,
    getActiveAppId: () => kit.ctx.state.activeAppRecordId,
    toggleApp: (appId) => kit.api.toggleApp(appId),
    getInspectorTree: (inspectorId, filter = "") =>
      kit.api.getInspectorTree({ inspectorId, filter }),
    getInspectorState: (inspectorId, nodeId) =>
      kit.api.getInspectorState({ inspectorId, nodeId }),
    getComponentRoots: (appId, componentId) => {
      const app = kit.ctx.state.appRecords.find(
        (record) => record.id === appId,
      );
      const instance = app?.instanceMap?.get(componentId) as
        Record<string, unknown> | undefined;
      const roots: Element[] = [];
      collectElements(instance?.subTree, roots, new Set());
      return [...new Set(roots)];
    },
    onRevision: (callback) => {
      for (const event of [
        "componentAdded",
        "componentUpdated",
        "componentRemoved",
      ])
        kit.hook.on[event]?.((app: unknown) =>
          callback(
            kit.ctx.state.appRecords.find(
              (record) => (record as { app?: unknown }).app === app,
            )?.id,
          ),
        );
    },
  };
}
