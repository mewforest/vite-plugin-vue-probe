import { normalizeQueryPath } from "./path.js";
import type { QueryPath } from "./path.js";
import type {
  AppPlan,
  AppSelectorPlan,
  ComponentFromDOMPlan,
  ComponentPlan,
  DetailedStatePlan,
  PiniaStorePlan,
  QueryPlan,
  QueryRuntime,
} from "./plan.js";
import type {
  AppQuery,
  AppQuerySelector,
  AppsQuery,
  ComponentDOMQuery,
  ComponentFromDOMQuery,
  ComponentQuery,
  ComponentStateQuery,
  ComponentsQuery,
  DetailedStateQuery,
  PiniaStateQuery,
  PiniaStoreQuery,
  PiniaStoresQuery,
  ProbeQueryRoot,
  QueryComponentDOMOptions,
  QueryComponentFromDOMOptions,
  QueryDetailedOptions,
  QueryFormat,
  QueryPageOptions,
  QueryPiniaStoresOptions,
  QueryStateOptions,
  QueryTreeOptions,
  TreeQuery,
} from "./types.js";

function terminal<T>(
  runtime: QueryRuntime,
  plan: QueryPlan,
  methods: Record<string, unknown> = {},
): T {
  return Object.freeze({
    ...methods,
    run: () => runtime.run(plan),
    show: (format?: QueryFormat) => runtime.show(plan, format),
  }) as T;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function options<T extends object>(value: T | undefined, label: string): T {
  if (value === undefined) return Object.freeze({}) as T;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return Object.freeze({ ...value });
}

function selectorPlan(selector?: AppQuerySelector): AppSelectorPlan {
  if (selector === undefined) return Object.freeze({ kind: "default" });
  if (typeof selector === "string") {
    return Object.freeze({ kind: "id", id: nonEmpty(selector, "appId") });
  }
  if (selector === null || typeof selector !== "object") {
    throw new TypeError("App selector must be an appId or { name }");
  }
  return Object.freeze({
    kind: "name",
    name: nonEmpty(selector.name, "app name"),
  });
}

function appPlan(selector?: AppQuerySelector): AppPlan {
  return Object.freeze({ kind: "app", selector: selectorPlan(selector) });
}

function detailedQuery(
  runtime: QueryRuntime,
  plan: DetailedStatePlan,
): DetailedStateQuery {
  return terminal<DetailedStateQuery>(runtime, plan, {
    page(page: QueryPageOptions) {
      if (
        page === null ||
        typeof page !== "object" ||
        !Number.isSafeInteger(page.offset) ||
        page.offset < 0 ||
        !Number.isSafeInteger(page.limit) ||
        page.limit <= 0
      ) {
        throw new TypeError(
          "Page offset must be a non-negative safe integer and limit must be positive",
        );
      }
      return detailedQuery(
        runtime,
        Object.freeze({
          ...plan,
          page: Object.freeze({ offset: page.offset, limit: page.limit }),
        }),
      );
    },
  });
}

function stateOrDetailed(
  runtime: QueryRuntime,
  target: ComponentPlan | PiniaStorePlan | ComponentFromDOMPlan,
  first: QueryPath | QueryStateOptions | undefined,
  second: QueryDetailedOptions | undefined,
): ComponentStateQuery | PiniaStateQuery | DetailedStateQuery {
  if (typeof first === "string" || Array.isArray(first)) {
    return detailedQuery(
      runtime,
      Object.freeze({
        kind: "detailed-state",
        target,
        path: Object.freeze(normalizeQueryPath(first)),
        options: options(second, "Detailed state options"),
      }),
    );
  }
  const stateOptions = options(first, "State options");
  if (target.kind === "pinia-store") {
    return terminal<PiniaStateQuery>(
      runtime,
      Object.freeze({ kind: "pinia-state", store: target, options: stateOptions }),
    );
  }
  return terminal<ComponentStateQuery>(
    runtime,
    Object.freeze({
      kind: "component-state",
      component: target,
      options: stateOptions,
    }),
  );
}

function componentQuery(
  runtime: QueryRuntime,
  plan: ComponentPlan,
): ComponentQuery {
  return terminal<ComponentQuery>(runtime, plan, {
    nth(index: number) {
      if (!Number.isSafeInteger(index) || index < 0) {
        throw new TypeError("Component index must be a non-negative safe integer");
      }
      return componentQuery(runtime, Object.freeze({ ...plan, index }));
    },
    get(
      first?: QueryPath | QueryStateOptions,
      second?: QueryDetailedOptions,
    ) {
      return stateOrDetailed(runtime, plan, first, second);
    },
    dom(domOptions?: QueryComponentDOMOptions) {
      return terminal<ComponentDOMQuery>(
        runtime,
        Object.freeze({
          kind: "component-dom",
          component: plan,
          options: options(domOptions, "Component DOM options"),
        }),
      );
    },
  });
}

function piniaStoreQuery(
  runtime: QueryRuntime,
  plan: PiniaStorePlan,
): PiniaStoreQuery {
  return terminal<PiniaStoreQuery>(runtime, plan, {
    get(first?: QueryPath | QueryStateOptions, second?: QueryDetailedOptions) {
      return stateOrDetailed(runtime, plan, first, second);
    },
  });
}

function fromDOMQuery(
  runtime: QueryRuntime,
  plan: ComponentFromDOMPlan,
): ComponentFromDOMQuery {
  return terminal<ComponentFromDOMQuery>(runtime, plan, {
    get(first?: QueryPath | QueryStateOptions, second?: QueryDetailedOptions) {
      return stateOrDetailed(runtime, plan, first, second);
    },
  });
}

function appQuery(runtime: QueryRuntime, plan: AppPlan): AppQuery {
  return terminal<AppQuery>(runtime, plan, {
    tree(treeOptions?: QueryTreeOptions): TreeQuery {
      const supplied = options(treeOptions, "Tree options");
      return terminal<TreeQuery>(
        runtime,
        Object.freeze({
          kind: "tree",
          app: plan,
          options: Object.freeze({
            ...supplied,
            format: supplied.format ?? "flat",
            maxDepth:
              supplied.maxDepth === undefined ? 5 : supplied.maxDepth,
            includeFile: supplied.includeFile ?? false,
          }),
        }),
      );
    },
    component(name: string): ComponentQuery {
      return componentQuery(
        runtime,
        Object.freeze({
          kind: "component",
          app: plan,
          name: nonEmpty(name, "Component name"),
          index: 0,
        }),
      );
    },
    components(name?: string): ComponentsQuery {
      const componentName =
        name === undefined ? undefined : nonEmpty(name, "Component name");
      const componentPlan =
        componentName === undefined
          ? { kind: "components" as const, app: plan }
          : { kind: "components" as const, app: plan, name: componentName };
      return terminal<ComponentsQuery>(runtime, Object.freeze(componentPlan));
    },
    pinia(arg?: string | QueryPiniaStoresOptions) {
      if (typeof arg === "string") {
        return piniaStoreQuery(
          runtime,
          Object.freeze({
            kind: "pinia-store",
            app: plan,
            storeId: nonEmpty(arg, "Pinia store id"),
          }),
        );
      }
      return terminal<PiniaStoresQuery>(
        runtime,
        Object.freeze({
          kind: "pinia-stores",
          app: plan,
          options: options(arg, "Pinia stores options"),
        }),
      );
    },
    fromDOM(
      target: string | Element,
      domOptions?: QueryComponentFromDOMOptions,
    ): ComponentFromDOMQuery {
      return fromDOMQuery(
        runtime,
        Object.freeze({
          kind: "component-from-dom",
          app: plan,
          target,
          options: options(domOptions, "Component from DOM options"),
        }),
      );
    },
  });
}

export function createProbeQueryRoot(runtime: QueryRuntime): ProbeQueryRoot {
  return Object.freeze({
    apps(): AppsQuery {
      return terminal<AppsQuery>(runtime, Object.freeze({ kind: "apps" }));
    },
    app(selector?: AppQuerySelector): AppQuery {
      return appQuery(runtime, appPlan(selector));
    },
  });
}
