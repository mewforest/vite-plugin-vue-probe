import type {
  AppSummary,
  ComponentDOMOptions,
  ComponentDOMResult,
  ComponentFromDOMOptions,
  ComponentFromDOMResult,
  ComponentStateResult,
  ComponentTreeNode,
  ComponentTreeOptions,
  ComponentTreeResult,
  DetailedStateOptions,
  DetailedStateResult,
  PiniaStateResult,
  PiniaStoreSummary,
  PiniaStoresOptions,
  StateReadOptions,
} from "../public-types.js";
import type { QueryPath } from "./path.js";

export type QueryFormat =
  | "markdown"
  | "json"
  | "raw"
  | "table"
  | "paths"
  | "mermaid";

export type QueryTable = ReadonlyArray<Record<string, unknown>>;

export type ShownValue<F extends QueryFormat, T> = F extends "raw"
  ? T
  : F extends "table"
    ? QueryTable
    : string;

export interface QueryTerminal<
  T,
  TDefault extends QueryFormat,
  TAllowed extends QueryFormat,
> {
  run(): Promise<T>;
  show(): Promise<ShownValue<TDefault, T>>;
  show<F extends TAllowed>(format: F): Promise<ShownValue<F, T>>;
}

export type QueryTreeOptions = Omit<ComponentTreeOptions, "appId">;
export type QueryStateOptions = Omit<
  StateReadOptions,
  "appId" | "expectedRevision"
>;
export type QueryDetailedOptions = Omit<
  DetailedStateOptions,
  "offset" | "limit" | "expectedRevision"
>;
export interface QueryPageOptions {
  offset: number;
  limit: number;
}
export type QueryPiniaStoresOptions = Omit<PiniaStoresOptions, "appId">;
export type QueryComponentDOMOptions = Omit<
  ComponentDOMOptions,
  "appId" | "expectedRevision"
>;
export type QueryComponentFromDOMOptions = Omit<
  ComponentFromDOMOptions,
  "appId" | "expectedRevision"
>;

export type AppQuerySelector = string | { name: string };

export interface ProbeQueryRoot {
  apps(): AppsQuery;
  app(selector?: AppQuerySelector): AppQuery;
}

export interface AppsQuery
  extends QueryTerminal<
    AppSummary[],
    "table",
    "table" | "json" | "raw"
  > {}

export interface AppQuery
  extends QueryTerminal<
    AppSummary,
    "table",
    "table" | "json" | "raw"
  > {
  tree(options?: QueryTreeOptions): TreeQuery;
  component(name: string): ComponentQuery;
  components(name?: string): ComponentsQuery;
  pinia(options?: QueryPiniaStoresOptions): PiniaStoresQuery;
  pinia(storeId: string): PiniaStoreQuery;
  fromDOM(
    target: string | Element,
    options?: QueryComponentFromDOMOptions,
  ): ComponentFromDOMQuery;
}

export interface TreeQuery
  extends QueryTerminal<
    ComponentTreeResult,
    "markdown",
    "markdown" | "mermaid" | "json" | "raw"
  > {}

export interface ComponentQuery
  extends QueryTerminal<
    ComponentTreeNode,
    "markdown",
    "markdown" | "json" | "raw"
  > {
  nth(index: number): ComponentQuery;
  get(options?: QueryStateOptions): ComponentStateQuery;
  get(path: QueryPath, options?: QueryDetailedOptions): DetailedStateQuery;
  dom(options?: QueryComponentDOMOptions): ComponentDOMQuery;
}

export interface ComponentsQuery
  extends QueryTerminal<
    ComponentTreeNode[],
    "markdown",
    "markdown" | "json" | "raw"
  > {}

export interface ComponentStateQuery
  extends QueryTerminal<
    ComponentStateResult,
    "markdown",
    "markdown" | "paths" | "json" | "raw"
  > {}

export interface DetailedStateQuery
  extends QueryTerminal<
    DetailedStateResult,
    "markdown",
    "markdown" | "json" | "raw"
  > {
  page(options: QueryPageOptions): DetailedStateQuery;
}

export interface PiniaStoresQuery
  extends QueryTerminal<
    PiniaStoreSummary[],
    "table",
    "table" | "json" | "raw"
  > {}

export interface PiniaStoreQuery
  extends QueryTerminal<
    PiniaStoreSummary,
    "table",
    "table" | "json" | "raw"
  > {
  get(options?: QueryStateOptions): PiniaStateQuery;
  get(path: QueryPath, options?: QueryDetailedOptions): DetailedStateQuery;
}

export interface PiniaStateQuery
  extends QueryTerminal<
    PiniaStateResult,
    "markdown",
    "markdown" | "paths" | "json" | "raw"
  > {}

export interface ComponentDOMQuery
  extends QueryTerminal<
    ComponentDOMResult,
    "table",
    "table" | "json" | "raw"
  > {}

export interface ComponentFromDOMQuery
  extends QueryTerminal<
    ComponentFromDOMResult,
    "json",
    "json" | "raw"
  > {
  get(options?: QueryStateOptions): ComponentStateQuery;
  get(path: QueryPath, options?: QueryDetailedOptions): DetailedStateQuery;
}
