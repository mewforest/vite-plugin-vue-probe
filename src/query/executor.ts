import type {
  AppSummary,
  ComponentFromDOMResult,
  ComponentTreeNode,
  ComponentTreeResult,
  ProbeAPI,
} from "../public-types.js";
import { queryError, unwrapProbeResult } from "./error.js";
import type {
  AppPlan,
  ComponentFromDOMPlan,
  ComponentPlan,
  ComponentsPlan,
  PiniaStorePlan,
  QueryPlan,
  TreePlan,
} from "./plan.js";

export type ProbeQueryOperations = Pick<
  ProbeAPI,
  | "formatters"
  | "listApps"
  | "getComponentTree"
  | "getComponentState"
  | "getDetailedState"
  | "getPiniaStores"
  | "getPiniaState"
  | "getComponentDOM"
  | "getComponentFromDOM"
>;

interface ExecutionContext {
  readonly appId?: string;
  readonly revision?: number;
}

interface Executed<T> {
  readonly data: T;
  readonly context: ExecutionContext;
}

function breadthFirst(nodes: ComponentTreeNode[]): ComponentTreeNode[] {
  return nodes
    .map((node, sourceIndex) => ({ node, sourceIndex }))
    .sort(
      (left, right) =>
        left.node.depth - right.node.depth ||
        left.sourceIndex - right.sourceIndex,
    )
    .map(({ node }) => node);
}

export function createQueryExecutor(operations: ProbeQueryOperations): {
  execute(plan: QueryPlan): Promise<unknown>;
} {
  const listApps = async (plan: QueryPlan): Promise<Executed<AppSummary[]>> => {
    const result = unwrapProbeResult(
      await operations.listApps(),
      "list-apps",
      plan,
    );
    return { data: result.data, context: {} };
  };

  const resolveApp = async (plan: AppPlan): Promise<Executed<AppSummary>> => {
    const listed = await listApps(plan);
    const selector = plan.selector;
    let selected: AppSummary | undefined;
    if (selector.kind === "default") {
      selected = listed.data.find((app) => app.active) ?? listed.data[0];
    } else if (selector.kind === "id") {
      selected = listed.data.find((app) => app.id === selector.id);
    } else {
      selected = listed.data.find((app) => app.name === selector.name);
    }
    if (!selected) {
      throw queryError(
        plan,
        "APP_NOT_FOUND",
        "Vue application matching the query was not found",
        "resolve-app",
      );
    }
    return { data: selected, context: { appId: selected.id } };
  };

  const executeTree = async (
    plan: TreePlan,
  ): Promise<Executed<ComponentTreeResult>> => {
    const app = await resolveApp(plan.app);
    const result = unwrapProbeResult(
      await operations.getComponentTree({
        ...plan.options,
        appId: app.data.id,
      }),
      "read-tree",
      plan,
    );
    return {
      data: result.data,
      context: { appId: app.data.id, revision: result.meta.revision },
    };
  };

  const readMatches = async (
    plan: ComponentPlan | ComponentsPlan,
  ): Promise<Executed<ComponentTreeNode[]>> => {
    const app = await resolveApp(plan.app);
    const requestedName = plan.name;
    const result = unwrapProbeResult(
      await operations.getComponentTree({
        appId: app.data.id,
        ...(requestedName === undefined ? {} : { filter: requestedName }),
        format: "flat",
        maxDepth: null,
        includeFile: false,
      }),
      "read-tree",
      plan,
    );
    const matches = breadthFirst(
      requestedName === undefined
        ? result.data.nodes
        : result.data.nodes.filter((node) => node.name === requestedName),
    );
    return {
      data: matches,
      context: { appId: app.data.id, revision: result.meta.revision },
    };
  };

  const resolveComponent = async (
    plan: ComponentPlan,
  ): Promise<Executed<ComponentTreeNode>> => {
    const matches = await readMatches(plan);
    const selected = matches.data[plan.index];
    if (!selected) {
      throw queryError(
        plan,
        "COMPONENT_NOT_FOUND",
        `Vue component not found: ${plan.name} at index ${plan.index}`,
        "find-component",
      );
    }
    return { data: selected, context: matches.context };
  };

  const resolveFromDOM = async (
    plan: ComponentFromDOMPlan,
  ): Promise<Executed<ComponentFromDOMResult>> => {
    const app = await resolveApp(plan.app);
    const result = unwrapProbeResult(
      await operations.getComponentFromDOM(plan.target, {
        ...plan.options,
        appId: app.data.id,
      }),
      "resolve-component-from-dom",
      plan,
    );
    return {
      data: result.data,
      context: {
        appId: result.data.appId,
        revision: result.meta.revision,
      },
    };
  };

  const resolveComponentTarget = async (
    plan: ComponentPlan | ComponentFromDOMPlan,
  ): Promise<{
    readonly componentId: string;
    readonly appId: string;
    readonly revision: number | undefined;
  }> => {
    if (plan.kind === "component") {
      const resolved = await resolveComponent(plan);
      return {
        componentId: resolved.data.id,
        appId: resolved.context.appId!,
        revision: resolved.context.revision,
      };
    }
    const resolved = await resolveFromDOM(plan);
    return {
      componentId: resolved.data.componentId,
      appId: resolved.data.appId,
      revision: resolved.context.revision,
    };
  };

  const resolvePiniaApp = async (
    plan: PiniaStorePlan,
  ): Promise<Executed<AppSummary>> => resolveApp(plan.app);

  const executePlan = async (plan: QueryPlan): Promise<Executed<unknown>> => {
    switch (plan.kind) {
      case "apps":
        return listApps(plan);
      case "app":
        return resolveApp(plan);
      case "tree":
        return executeTree(plan);
      case "components":
        return readMatches(plan);
      case "component":
        return resolveComponent(plan);
      case "component-state": {
        const target = await resolveComponentTarget(plan.component);
        const result = unwrapProbeResult(
          await operations.getComponentState(target.componentId, {
            ...plan.options,
            appId: target.appId,
            ...(target.revision === undefined
              ? {}
              : { expectedRevision: target.revision }),
          }),
          "read-component-state",
          plan,
        );
        return {
          data: result.data,
          context: { appId: target.appId, revision: result.meta.revision },
        };
      }
      case "detailed-state": {
        let target:
          | {
              readonly kind: "component";
              readonly componentId: string;
              readonly appId: string;
            }
          | {
              readonly kind: "pinia";
              readonly storeId: string;
              readonly appId: string;
            };
        let revision: number | undefined;
        if (plan.target.kind === "pinia-store") {
          const app = await resolvePiniaApp(plan.target);
          target = {
            kind: "pinia",
            storeId: plan.target.storeId,
            appId: app.data.id,
          };
        } else {
          const component = await resolveComponentTarget(plan.target);
          target = {
            kind: "component",
            componentId: component.componentId,
            appId: component.appId,
          };
          revision = component.revision;
        }
        const result = unwrapProbeResult(
          await operations.getDetailedState(target, [...plan.path], {
            ...plan.options,
            ...(revision === undefined ? {} : { expectedRevision: revision }),
            ...(plan.page === undefined ? {} : plan.page),
          }),
          "read-detailed-state",
          plan,
        );
        return {
          data: result.data,
          context: { appId: target.appId, revision: result.meta.revision },
        };
      }
      case "pinia-stores": {
        const app = await resolveApp(plan.app);
        const result = unwrapProbeResult(
          await operations.getPiniaStores({
            ...plan.options,
            appId: app.data.id,
          }),
          "list-pinia-stores",
          plan,
        );
        return {
          data: result.data,
          context: { appId: app.data.id, revision: result.meta.revision },
        };
      }
      case "pinia-store": {
        const app = await resolvePiniaApp(plan);
        const result = unwrapProbeResult(
          await operations.getPiniaStores({ appId: app.data.id }),
          "list-pinia-stores",
          plan,
        );
        const store = result.data.find((candidate) => candidate.id === plan.storeId);
        if (!store) {
          throw queryError(
            plan,
            "STORE_NOT_FOUND",
            `Pinia store not found: ${plan.storeId}`,
            "find-store",
          );
        }
        return {
          data: store,
          context: { appId: app.data.id, revision: result.meta.revision },
        };
      }
      case "pinia-state": {
        const app = await resolvePiniaApp(plan.store);
        const result = unwrapProbeResult(
          await operations.getPiniaState(plan.store.storeId, {
            ...plan.options,
            appId: app.data.id,
          }),
          "read-pinia-state",
          plan,
        );
        return {
          data: result.data,
          context: { appId: app.data.id, revision: result.meta.revision },
        };
      }
      case "component-dom": {
        const component = await resolveComponent(plan.component);
        const appId = component.context.appId!;
        const result = unwrapProbeResult(
          await operations.getComponentDOM(component.data.id, {
            ...plan.options,
            appId,
            ...(component.context.revision === undefined
              ? {}
              : { expectedRevision: component.context.revision }),
          }),
          "read-component-dom",
          plan,
        );
        return {
          data: result.data,
          context: {
            appId,
            revision: result.meta.revision,
          },
        };
      }
      case "component-from-dom":
        return resolveFromDOM(plan);
      default:
        throw queryError(
          plan,
          "INTERNAL_ERROR",
          "Unsupported query plan",
          "execute",
        );
    }
  };

  return Object.freeze({
    async execute(plan: QueryPlan): Promise<unknown> {
      return (await executePlan(plan)).data;
    },
  });
}
