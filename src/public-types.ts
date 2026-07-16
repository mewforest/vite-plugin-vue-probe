export type JsonPrimitive = string | number | boolean | null;
export type StatePath = Array<string | number>;

export type ProbeErrorCode =
  | "NOT_READY"
  | "APP_NOT_FOUND"
  | "COMPONENT_NOT_FOUND"
  | "STORE_NOT_FOUND"
  | "PATH_NOT_FOUND"
  | "INVALID_OPTIONS"
  | "STALE_REVISION"
  | "INTERNAL_ERROR";

export interface ProbeError {
  code: ProbeErrorCode;
  message: string;
  details?: Record<string, JsonPrimitive | StatePath>;
}

export interface ResponseMeta {
  requestId: string;
  revision: number;
  observedAt: string;
}

export interface ProbeSuccess<T> {
  ok: true;
  data: T;
  meta: ResponseMeta;
}

export interface ProbeFailure {
  ok: false;
  error: ProbeError;
  meta: ResponseMeta;
}

export type ProbeResult<T> = ProbeSuccess<T> | ProbeFailure;

export interface UndefinedProbeValue {
  $type: "undefined";
}
export interface NonFiniteNumberProbeValue {
  $type: "number";
  value: "NaN" | "Infinity" | "-Infinity";
}
export interface BigIntProbeValue {
  $type: "bigint";
  value: string;
}
export interface DateProbeValue {
  $type: "date";
  value: string;
}
export interface MapProbeValue {
  $type: "map";
  size: number;
  entries: Array<[ProbeValue, ProbeValue]>;
}
export interface SetProbeValue {
  $type: "set";
  size: number;
  values: ProbeValue[];
}
export interface ErrorProbeValue {
  $type: "error";
  name: string;
  message: string;
}
export interface CircularReferenceProbeValue {
  $type: "circular-reference";
  targetPath: StatePath;
}
export interface StoreReferenceProbeValue {
  $type: "store-reference";
  storeId: string;
  appId?: string;
}

export type TruncatedKind = "array" | "object" | "string";

export interface TruncatedProbeValue {
  $type: "truncated";
  kind: TruncatedKind;
  path: StatePath;
  total: number;
  returned: number;
  preview: ProbeValue;
  nextOffset: number | null;
}

export type ProbeSpecialValue =
  | UndefinedProbeValue
  | NonFiniteNumberProbeValue
  | BigIntProbeValue
  | DateProbeValue
  | MapProbeValue
  | SetProbeValue
  | ErrorProbeValue
  | CircularReferenceProbeValue
  | StoreReferenceProbeValue
  | TruncatedProbeValue;

export type ProbeValue =
  | JsonPrimitive
  | ProbeSpecialValue
  | ProbeValue[]
  | { [key: string]: ProbeValue };

export interface ProbeCapabilities {
  apiVersion: string;
  vueDetected: boolean;
  piniaDetected: boolean;
  multipleApps: boolean;
  componentTree: true;
  componentState: true;
  detailedState: true;
  piniaState: boolean;
  componentDOM: true;
  stateMutation: false;
  eventTimeline: false;
  defaults: {
    maxDepth: 2;
    maxEntries: 25;
    maxStringLength: 500;
    detailMaxDepth: 3;
    detailPageSize: 50;
    hardMaxEntries: 200;
  };
}

export interface AppSummary {
  id: string;
  name: string;
  vueVersion: string;
  active: boolean;
  componentCount?: number;
}

export type ComponentTreeFormat = "nested" | "flat";

export interface ComponentTreeOptions {
  appId?: string;
  rootId?: string;
  filter?: string;
  format?: ComponentTreeFormat;
  maxDepth?: number | null;
  includeFile?: boolean;
}

export interface ComponentTreeNode {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  hasChildren: boolean;
  inactive?: boolean;
  fragment?: boolean;
  file?: string;
  children?: ComponentTreeNode[];
}

export interface ComponentTreeResult {
  appId: string;
  rootId: string;
  format: ComponentTreeFormat;
  nodes: ComponentTreeNode[];
  truncatedByDepth: boolean;
}

export interface SerializationBudget {
  maxDepth?: number;
  maxEntries?: number;
  maxStringLength?: number;
}

export interface StateReadOptions extends SerializationBudget {
  appId?: string;
  expectedRevision?: number;
  includeMetadata?: boolean;
}

export type ComponentStateSection =
  | "props"
  | "setup"
  | "data"
  | "computed"
  | "attrs"
  | "provided"
  | "injected"
  | "refs"
  | "pinia";

export type ComponentStateSections = Partial<
  Record<ComponentStateSection, Record<string, ProbeValue>>
>;

export interface StateEntryMetadata {
  reactivity?: "ref" | "reactive" | "computed" | "plain";
  readonly?: boolean;
  propType?: string;
  required?: boolean;
}

export type ComponentStateMetadata = Partial<
  Record<ComponentStateSection, Record<string, StateEntryMetadata>>
>;

export interface ComponentStateResult {
  appId: string;
  componentId: string;
  name: string;
  file?: string;
  state: ComponentStateSections;
  metadata?: ComponentStateMetadata;
}

export type StateTarget =
  | { kind: "component"; componentId: string; appId?: string }
  | { kind: "pinia"; storeId: string; appId?: string };

export interface DetailedStateOptions extends SerializationBudget {
  offset?: number;
  limit?: number;
  expectedRevision?: number;
}

export interface StatePage {
  offset: number;
  limit: number;
  returned: number;
  total: number;
  nextOffset: number | null;
}

export interface DetailedStateResult {
  target: StateTarget;
  path: StatePath;
  value: ProbeValue;
  page?: StatePage;
}

export interface PiniaStoresOptions {
  appId?: string;
  filter?: string;
}

export interface PiniaStoreSummary {
  appId: string;
  id: string;
  stateKeys: string[];
  getterKeys: string[];
  usedByComponentIds?: string[];
}

export interface PiniaStateResult {
  appId: string;
  storeId: string;
  state: Record<string, ProbeValue>;
  getters?: Record<string, ProbeValue>;
  customProperties?: Record<string, ProbeValue>;
}

export interface DOMRectJSON {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DOMNodeLocator {
  index: number;
  selector: string | null;
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  rect: DOMRectJSON;
  connected: boolean;
}

export interface ComponentDOMResult {
  appId: string;
  componentId: string;
  roots: DOMNodeLocator[];
}

export interface ProbeAPI {
  readonly version: string;
  getCapabilities(): Promise<ProbeResult<ProbeCapabilities>>;
  listApps(): Promise<ProbeResult<AppSummary[]>>;
  getComponentTree(
    options?: ComponentTreeOptions,
  ): Promise<ProbeResult<ComponentTreeResult>>;
  getComponentState(
    componentId: string,
    options?: StateReadOptions,
  ): Promise<ProbeResult<ComponentStateResult>>;
  getDetailedState(
    target: StateTarget,
    path: StatePath,
    options?: DetailedStateOptions,
  ): Promise<ProbeResult<DetailedStateResult>>;
  getPiniaStores(
    options?: PiniaStoresOptions,
  ): Promise<ProbeResult<PiniaStoreSummary[]>>;
  getPiniaState(
    storeId: string,
    options?: StateReadOptions,
  ): Promise<ProbeResult<PiniaStateResult>>;
  getComponentDOM(
    componentId: string,
  ): Promise<ProbeResult<ComponentDOMResult>>;
}

declare global {
  interface Window {
    VUE_PROBE?: ProbeAPI;
  }
}
