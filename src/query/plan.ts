import type { StatePath } from "../public-types.js";
import type {
  QueryComponentDOMOptions,
  QueryComponentFromDOMOptions,
  QueryDetailedOptions,
  QueryFormat,
  QueryPageOptions,
  QueryPiniaStoresOptions,
  QueryStateOptions,
  QueryTreeOptions,
} from "./types.js";

export type AppSelectorPlan =
  | { readonly kind: "default" }
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "name"; readonly name: string };

export interface AppPlan {
  readonly kind: "app";
  readonly selector: AppSelectorPlan;
}

export interface AppsPlan {
  readonly kind: "apps";
}

export interface TreePlan {
  readonly kind: "tree";
  readonly app: AppPlan;
  readonly options: Readonly<QueryTreeOptions>;
}

export interface ComponentPlan {
  readonly kind: "component";
  readonly app: AppPlan;
  readonly name: string;
  readonly index: number;
}

export interface ComponentsPlan {
  readonly kind: "components";
  readonly app: AppPlan;
  readonly name?: string;
}

export interface ComponentStatePlan {
  readonly kind: "component-state";
  readonly component: ComponentPlan | ComponentFromDOMPlan;
  readonly options: Readonly<QueryStateOptions>;
}

export interface DetailedStatePlan {
  readonly kind: "detailed-state";
  readonly target: ComponentPlan | PiniaStorePlan | ComponentFromDOMPlan;
  readonly path: Readonly<StatePath>;
  readonly options: Readonly<QueryDetailedOptions>;
  readonly page?: Readonly<QueryPageOptions>;
}

export interface PiniaStoresPlan {
  readonly kind: "pinia-stores";
  readonly app: AppPlan;
  readonly options: Readonly<QueryPiniaStoresOptions>;
}

export interface PiniaStorePlan {
  readonly kind: "pinia-store";
  readonly app: AppPlan;
  readonly storeId: string;
}

export interface PiniaStatePlan {
  readonly kind: "pinia-state";
  readonly store: PiniaStorePlan;
  readonly options: Readonly<QueryStateOptions>;
}

export interface ComponentDOMPlan {
  readonly kind: "component-dom";
  readonly component: ComponentPlan;
  readonly options: Readonly<QueryComponentDOMOptions>;
}

export interface ComponentFromDOMPlan {
  readonly kind: "component-from-dom";
  readonly app: AppPlan;
  readonly target: string | Element;
  readonly options: Readonly<QueryComponentFromDOMOptions>;
}

export type QueryPlan =
  | AppsPlan
  | AppPlan
  | TreePlan
  | ComponentPlan
  | ComponentsPlan
  | ComponentStatePlan
  | DetailedStatePlan
  | PiniaStoresPlan
  | PiniaStorePlan
  | PiniaStatePlan
  | ComponentDOMPlan
  | ComponentFromDOMPlan;

export interface QueryRuntime {
  run(plan: QueryPlan): Promise<unknown>;
  show(plan: QueryPlan, format?: QueryFormat): Promise<unknown>;
}
