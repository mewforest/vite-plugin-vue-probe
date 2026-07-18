import type {
  AppSummary,
  ComponentTreeNode,
  ComponentTreeResult,
  ProbeAPI,
} from "../public-types.js";
import { queryError, unwrapProbeResult } from "./error.js";
import type {
  AppPlan,
  ComponentPlan,
  ComponentsPlan,
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
      case "component": {
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
      }
      default:
        throw queryError(
          plan,
          "INTERNAL_ERROR",
          `Unsupported query plan: ${plan.kind}`,
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
