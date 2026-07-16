import type {
  ProbeErrorCode,
  AppSummary,
  ComponentStateMetadata,
  ComponentTreeNode,
  PiniaStoreSummary,
} from "../public-types.js";

export interface InspectorStateEntry {
  type?: string;
  key: string;
  value: unknown;
  editable?: boolean;
  objectType?: "ref" | "reactive" | "computed" | "other";
  meta?: { type?: string; required?: boolean };
}

export interface InspectorComponentPayload {
  id: string;
  name: string;
  file?: string;
  state: InspectorStateEntry[];
}

export interface InspectorPiniaPayload {
  [section: string]: InspectorStateEntry[];
}

export type RawStateMap = Record<string, unknown>;

export interface RawComponentState {
  appId: string;
  componentId: string;
  name: string;
  file?: string;
  state: Partial<
    Record<
      | "props"
      | "setup"
      | "data"
      | "computed"
      | "attrs"
      | "provided"
      | "injected"
      | "refs"
      | "pinia",
      RawStateMap
    >
  >;
  metadata?: ComponentStateMetadata;
}

export interface RawPiniaState {
  appId: string;
  storeId: string;
  state: RawStateMap;
  getters?: RawStateMap;
  customProperties?: RawStateMap;
}

export interface RawComponentTreeResult {
  appId: string;
  rootId: string;
  nodes: ComponentTreeNode[];
}

export interface ProbeDataSource {
  init(): void;
  dispose?(): void;
  hasApp(appId: string): boolean;
  hasPiniaInspector(appId: string): Promise<boolean>;
  listApps(): AppSummary[];
  getActiveAppId(): string | undefined;
  getRevision(appId?: string): number;
  getComponentTree(
    appId: string,
    filter?: string,
    rootId?: string,
  ): Promise<RawComponentTreeResult>;
  getComponentState(
    appId: string,
    componentId: string,
  ): Promise<RawComponentState>;
  getPiniaStores(
    appId: string,
    filter?: string,
    includeKeys?: boolean,
  ): Promise<PiniaStoreSummary[]>;
  getPiniaState(appId: string, storeId: string): Promise<RawPiniaState>;
  getComponentRoots(appId: string, componentId: string): Element[];
}

export class DataSourceError extends Error {
  constructor(
    public readonly code: ProbeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DataSourceError";
  }
}
