import type {
  AppSummary,
  ComponentDOMResult,
  ComponentStateResult,
  ComponentTreeNode,
  ComponentTreeResult,
  DetailedStateResult,
  PiniaStateResult,
  PiniaStoreSummary,
  ProbeFormatters,
} from "../public-types.js";
import { ProbeQueryError, queryError } from "./error.js";
import type { QueryPlan } from "./plan.js";
import type { QueryFormat, QueryTable } from "./types.js";

interface FormatPolicy {
  readonly defaultFormat: QueryFormat;
  readonly allowed: ReadonlySet<QueryFormat>;
}

const policy = (
  defaultFormat: QueryFormat,
  ...allowed: QueryFormat[]
): FormatPolicy => ({ defaultFormat, allowed: new Set(allowed) });

function formatPolicy(plan: QueryPlan): FormatPolicy {
  switch (plan.kind) {
    case "apps":
    case "app":
      return policy("table", "table", "json", "raw");
    case "tree":
      return policy("markdown", "markdown", "mermaid", "json", "raw");
    case "component":
    case "components":
      return policy("markdown", "markdown", "json", "raw");
    case "component-state":
    case "pinia-state":
      return policy("markdown", "markdown", "paths", "json", "raw");
    case "detailed-state":
      return policy("markdown", "markdown", "json", "raw");
    case "pinia-stores":
    case "pinia-store":
      return policy("table", "table", "json", "raw");
    case "component-dom":
      return policy("table", "table", "json", "raw");
    case "component-from-dom":
      return policy("json", "json", "raw");
  }
}

function appRows(data: AppSummary | AppSummary[]): QueryTable {
  const apps = Array.isArray(data) ? data : [data];
  return apps.map((app) => ({
    id: app.id,
    name: app.name,
    vueVersion: app.vueVersion,
    active: app.active,
    ...(app.componentCount === undefined
      ? {}
      : { componentCount: app.componentCount }),
  }));
}

function storeRows(
  data: PiniaStoreSummary | PiniaStoreSummary[],
): QueryTable {
  const stores = Array.isArray(data) ? data : [data];
  return stores.map((store) => ({
    appId: store.appId,
    id: store.id,
    ...(store.stateKeys === undefined
      ? {}
      : { stateKeys: store.stateKeys.join(", ") }),
    ...(store.getterKeys === undefined
      ? {}
      : { getterKeys: store.getterKeys.join(", ") }),
  }));
}

function domRows(data: ComponentDOMResult): QueryTable {
  return data.roots.map((root) => ({
    index: root.index,
    selector: root.selector,
    tag: root.tag,
    connected: root.connected,
    text: root.text ?? "",
    x: root.rect.x,
    y: root.rect.y,
    width: root.rect.width,
    height: root.rect.height,
  }));
}

function componentMarkdown(
  data: ComponentTreeNode | ComponentTreeNode[],
): string {
  const nodes = Array.isArray(data) ? data : [data];
  return nodes
    .map(
      (node) =>
        `${"  ".repeat(Math.max(0, node.depth))}- ${node.name} (${node.id})`,
    )
    .join("\n");
}

function piniaPayload(data: PiniaStateResult): Record<string, unknown> {
  return {
    state: data.state,
    ...(data.getters === undefined ? {} : { getters: data.getters }),
    ...(data.customProperties === undefined
      ? {}
      : { customProperties: data.customProperties }),
  };
}

function detailedMarkdown(
  data: DetailedStateResult,
  formatters: ProbeFormatters,
): string {
  const rendered = `\`\`\`json\n${formatters.toCleanJson(data.value)}\n\`\`\``;
  if (!data.page) return rendered;
  return `${rendered}\n\n_Page: offset ${data.page.offset}, limit ${data.page.limit}, returned ${data.page.returned}, total ${data.page.total}, nextOffset ${data.page.nextOffset ?? "null"}_`;
}

function markdown(
  plan: QueryPlan,
  data: unknown,
  formatters: ProbeFormatters,
): string {
  switch (plan.kind) {
    case "tree":
      return formatters.toMarkdown(data as ComponentTreeResult);
    case "component":
    case "components":
      return componentMarkdown(data as ComponentTreeNode | ComponentTreeNode[]);
    case "component-state":
      return formatters.toMarkdown((data as ComponentStateResult).state);
    case "pinia-state":
      return formatters.toMarkdown(
        piniaPayload(data as PiniaStateResult) as ComponentStateResult["state"],
      );
    case "detailed-state":
      return detailedMarkdown(data as DetailedStateResult, formatters);
    default:
      throw queryError(
        plan,
        "INVALID_OPTIONS",
        `Markdown is not supported for ${plan.kind}`,
        "render",
      );
  }
}

function paths(
  plan: QueryPlan,
  data: unknown,
  formatters: ProbeFormatters,
): string {
  if (plan.kind === "component-state") {
    return formatters.stateToPaths((data as ComponentStateResult).state);
  }
  if (plan.kind === "pinia-state") {
    return formatters.stateToPaths(
      piniaPayload(data as PiniaStateResult) as ComponentStateResult["state"],
    );
  }
  throw queryError(
    plan,
    "INVALID_OPTIONS",
    `Paths are not supported for ${plan.kind}`,
    "render",
  );
}

function table(plan: QueryPlan, data: unknown): QueryTable {
  switch (plan.kind) {
    case "apps":
    case "app":
      return appRows(data as AppSummary | AppSummary[]);
    case "pinia-stores":
    case "pinia-store":
      return storeRows(data as PiniaStoreSummary | PiniaStoreSummary[]);
    case "component-dom":
      return domRows(data as ComponentDOMResult);
    default:
      throw queryError(
        plan,
        "INVALID_OPTIONS",
        `Table is not supported for ${plan.kind}`,
        "render",
      );
  }
}

interface RenderedQueryResult {
  readonly consoleMethod: "log" | "table" | "dir";
  readonly value: unknown;
}

export function renderQueryResult(
  plan: QueryPlan,
  data: unknown,
  requestedFormat: QueryFormat | undefined,
  formatters: ProbeFormatters,
): RenderedQueryResult {
  const formats = formatPolicy(plan);
  const format = requestedFormat ?? formats.defaultFormat;
  if (!formats.allowed.has(format)) {
    throw queryError(
      plan,
      "INVALID_OPTIONS",
      `Format ${format} is not supported for ${plan.kind}`,
      "render",
    );
  }
  try {
    switch (format) {
      case "raw":
        return { consoleMethod: "dir", value: data };
      case "json":
        return { consoleMethod: "log", value: formatters.toCleanJson(data) };
      case "table":
        return { consoleMethod: "table", value: table(plan, data) };
      case "markdown":
        return { consoleMethod: "log", value: markdown(plan, data, formatters) };
      case "paths":
        return { consoleMethod: "log", value: paths(plan, data, formatters) };
      case "mermaid":
        return {
          consoleMethod: "log",
          value: formatters.treeToMermaid(data as ComponentTreeResult),
        };
    }
  } catch (error) {
    if (error instanceof ProbeQueryError) throw error;
    throw queryError(
      plan,
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Query rendering failed",
      "render",
    );
  }
}

export function showQueryResult(
  plan: QueryPlan,
  data: unknown,
  requestedFormat: QueryFormat | undefined,
  formatters: ProbeFormatters,
): unknown {
  const rendered = renderQueryResult(plan, data, requestedFormat, formatters);
  if (rendered.consoleMethod === "table") console.table(rendered.value);
  else if (rendered.consoleMethod === "dir") console.dir(rendered.value);
  else console.log(rendered.value);
  return rendered.value;
}
