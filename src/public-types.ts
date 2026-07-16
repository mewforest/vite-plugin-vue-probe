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
  truncated?: true;
  totalDigits?: number;
}
export interface DateProbeValue {
  $type: "date";
  value: string;
}
export interface MapProbeValue {
  $type: "map";
  size: number;
  entries: Array<[ProbeValue, ProbeValue]>;
  returned: number;
  nextOffset: number | null;
}
export interface SetProbeValue {
  $type: "set";
  size: number;
  values: ProbeValue[];
  returned: number;
  nextOffset: number | null;
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
  reason?: "node-budget" | "string-budget" | "key-length";
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
    maxDepth: number;
    maxEntries: number;
    maxStringLength: number;
    detailMaxDepth: number;
    detailPageSize: number;
    hardMaxEntries: number;
    hardMaxDepth: number;
    hardMaxStringLength: number;
    hardMaxTotalStringLength: number;
    hardMaxNodes: number;
    hardMaxOffset: number;
    hardMaxPathSegments: number;
    hardMaxPathSegmentLength: number;
    hardMaxPathTotalLength: number;
    hardMaxIdentifierLength: number;
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

export type SerializedStateMap =
  | Record<string, ProbeValue>
  | TruncatedProbeValue
  | ErrorProbeValue;

export type ComponentStateSections = Partial<
  Record<ComponentStateSection, SerializedStateMap>
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

export type ResolvedStateTarget =
  | { kind: "component"; componentId: string; appId: string }
  | { kind: "pinia"; storeId: string; appId: string };

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
  target: ResolvedStateTarget;
  path: StatePath;
  value: ProbeValue;
  page?: StatePage;
}

export interface PiniaStoresOptions {
  appId?: string;
  filter?: string;
  includeKeys?: boolean;
}

export interface PiniaStoreSummary {
  appId: string;
  id: string;
  stateKeys?: string[];
  getterKeys?: string[];
}

export interface PiniaStateResult {
  appId: string;
  storeId: string;
  state: SerializedStateMap;
  getters?: SerializedStateMap;
  customProperties?: SerializedStateMap;
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
  shadowHostSelectors?: string[];
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

export interface ComponentDOMOptions {
  appId?: string;
  expectedRevision?: number;
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
    options?: ComponentDOMOptions,
  ): Promise<ProbeResult<ComponentDOMResult>>;
}

declare global {
  interface Window {
    VUE_PROBE?: ProbeAPI;
  }
}
