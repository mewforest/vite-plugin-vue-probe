import type {
  ComponentDOMResult,
  ComponentStateResult,
  ComponentTreeNode,
  ComponentTreeResult,
  PiniaStateResult,
  ProbeFormatters,
  StatePath,
  TruncatedProbeValue,
} from "../public-types.js";

type StateData =
  | ComponentStateResult["state"]
  | PiniaStateResult["state"];
type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: UnknownRecord, key: string): boolean {
  return Object.hasOwn(value, key);
}

function hasExactKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return (
    required.every((key) => hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function isTruncated(value: unknown): value is TruncatedProbeValue {
  return (
    isRecord(value) &&
    value.$type === "truncated" &&
    hasExactKeys(
      value,
      [
        "$type",
        "kind",
        "path",
        "total",
        "returned",
        "preview",
        "nextOffset",
      ],
      ["reason"],
    ) &&
    (value.kind === "array" ||
      value.kind === "object" ||
      value.kind === "string") &&
    Array.isArray(value.path) &&
    typeof value.total === "number" &&
    typeof value.returned === "number" &&
    hasOwn(value, "preview") &&
    (value.nextOffset === null || typeof value.nextOffset === "number")
  );
}

function pathSegment(segment: string | number, first: boolean): string {
  if (typeof segment === "number") return `[${segment}]`;
  if (/^[A-Za-z_$][\w$]*$/.test(segment))
    return first ? segment : `.${segment}`;
  return `[${JSON.stringify(segment)}]`;
}

function formatPath(path: StatePath): string {
  return path.reduce<string>(
    (result, segment, index) => result + pathSegment(segment, index === 0),
    "",
  );
}

function truncatedLabel(value: TruncatedProbeValue, details: boolean): string {
  const kind =
    value.kind === "array"
      ? "Array"
      : value.kind === "object"
        ? "Object"
        : "String";
  const suffix = details
    ? `; returned ${value.returned}; nextOffset ${value.nextOffset ?? "null"}`
    : "";
  return `[${kind} ${value.total}] (Truncated${suffix})`;
}

function recognizedType(value: UnknownRecord): string | undefined {
  const type = value.$type;
  if (typeof type !== "string") return undefined;
  switch (type) {
    case "undefined":
      return Object.keys(value).length === 1 ? type : undefined;
    case "number":
      return hasExactKeys(value, ["$type", "value"]) &&
        typeof value.value === "string"
        ? type
        : undefined;
    case "bigint":
      return hasExactKeys(
        value,
        ["$type", "value"],
        ["truncated", "totalDigits"],
      ) && typeof value.value === "string"
        ? type
        : undefined;
    case "date":
      return hasExactKeys(value, ["$type", "value"]) &&
        typeof value.value === "string"
        ? type
        : undefined;
    case "error":
      return hasExactKeys(value, ["$type", "name", "message"]) &&
        typeof value.name === "string" &&
        typeof value.message === "string"
        ? type
        : undefined;
    case "circular-reference":
      return hasExactKeys(value, ["$type", "targetPath"]) &&
        Array.isArray(value.targetPath)
        ? type
        : undefined;
    case "store-reference":
      return hasExactKeys(value, ["$type", "storeId"], ["appId"]) &&
        typeof value.storeId === "string"
        ? type
        : undefined;
    case "map":
      return hasExactKeys(value, [
        "$type",
        "size",
        "entries",
        "returned",
        "nextOffset",
      ]) &&
        Array.isArray(value.entries) &&
        typeof value.size === "number"
        ? type
        : undefined;
    case "set":
      return hasExactKeys(value, [
        "$type",
        "size",
        "values",
        "returned",
        "nextOffset",
      ]) &&
        Array.isArray(value.values) &&
        typeof value.size === "number"
        ? type
        : undefined;
    case "truncated":
      return isTruncated(value) ? type : undefined;
    default:
      return undefined;
  }
}

function compact(value: unknown, detailedTruncation = false): string {
  if (isTruncated(value)) return truncatedLabel(value, detailedTruncation);
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return `[Array ${value.length}]`;
  if (!isRecord(value)) return String(value);

  switch (recognizedType(value)) {
    case "undefined":
      return "undefined";
    case "number":
      return String(value.value);
    case "bigint":
      return `${String(value.value)}n`;
    case "date":
      return `Date(${String(value.value)})`;
    case "error":
      return `Error(${String(value.name)}: ${String(value.message)})`;
    case "circular-reference":
      return `[Circular -> ${formatPath(value.targetPath as StatePath) || "$"}]`;
    case "store-reference":
      return `[Store ${String(value.storeId)}]`;
    case "map":
      return `[Map ${String(value.size)}]`;
    case "set":
      return `[Set ${String(value.size)}]`;
    default:
      return `{Object ${Object.keys(value).length}}`;
  }
}

function stateToPaths(stateData: StateData): string {
  const lines: string[] = [];
  const visit = (value: unknown, path: StatePath): void => {
    if (isTruncated(value)) {
      lines.push(
        `${formatPath(value.path.length > 0 ? value.path : path) || "$"} = ${compact(value, true)}`,
      );
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) lines.push(`${formatPath(path) || "$"} = [Array 0]`);
      else value.forEach((item, index) => visit(item, [...path, index]));
      return;
    }
    if (isRecord(value) && recognizedType(value) === undefined) {
      const entries = Object.entries(value);
      if (entries.length === 0)
        lines.push(`${formatPath(path) || "$"} = {Object 0}`);
      else
        for (const [key, child] of entries) visit(child, [...path, key]);
      return;
    }
    lines.push(`${formatPath(path) || "$"} = ${compact(value)}`);
  };
  visit(stateData, []);
  return lines.join("\n");
}

function flattenTree(nodes: readonly ComponentTreeNode[]): ComponentTreeNode[] {
  const result: ComponentTreeNode[] = [];
  const seen = new Set<string>();
  const visit = (node: ComponentTreeNode): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    result.push(node);
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  return result;
}

function isTree(value: unknown): value is ComponentTreeResult {
  return (
    isRecord(value) &&
    Array.isArray(value.nodes) &&
    (value.format === "nested" || value.format === "flat") &&
    typeof value.appId === "string"
  );
}

function yamlKey(key: string): string {
  return /^[^\s:#-][^:\n]*$/.test(key) ? key : JSON.stringify(key);
}

function toMarkdown(data: ComponentTreeResult | StateData): string {
  if (isTree(data)) {
    const nodes = flattenTree(data.nodes);
    const depths = new Map(nodes.map((node) => [node.id, node.depth]));
    return nodes
      .map((node) => {
        const depth = node.parentId
          ? (depths.get(node.parentId) ?? Math.max(0, node.depth - 1)) + 1
          : node.depth;
        return `${"  ".repeat(Math.max(0, depth))}- ${node.name} (${node.id})`;
      })
      .join("\n");
  }

  const lines: string[] = [];
  const visit = (value: unknown, depth: number, key?: string): void => {
    const indent = "  ".repeat(depth);
    const prefix = key === undefined ? `${indent}- ` : `${indent}- ${yamlKey(key)}:`;
    if (
      isTruncated(value) ||
      !isRecord(value) ||
      recognizedType(value) !== undefined ||
      Array.isArray(value)
    ) {
      lines.push(`${prefix}${key === undefined ? "" : " "}${compact(value)}`);
      return;
    }
    lines.push(prefix);
    for (const [childKey, child] of Object.entries(value))
      visit(child, depth + 1, childKey);
  };
  if (isRecord(data) && recognizedType(data) === undefined) {
    for (const [key, value] of Object.entries(data)) visit(value, 0, key);
  } else {
    visit(data, 0);
  }
  return lines.join("\n");
}

function tableCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function numberText(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "?";
}

function domToTable(locators: ComponentDOMResult["roots"]): string {
  const lines = [
    "| Selector | Tag | Rect (x,y,w,h) | Text Preview |",
    "| --- | --- | --- | --- |",
  ];
  for (const locator of locators) {
    const selector = locator.selector
      ? `\`${tableCell(locator.selector).replace(/`/g, "\\`")}\``
      : "*(unavailable)*";
    const text = tableCell((locator.text ?? "").slice(0, 120));
    const rect = [
      locator.rect.x,
      locator.rect.y,
      locator.rect.width,
      locator.rect.height,
    ]
      .map(numberText)
      .join(",");
    lines.push(
      `| ${selector} | \`${tableCell(locator.tag)}\` | ${rect} | ${text} |`,
    );
  }
  return lines.join("\n");
}

function mermaidText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/[\r\n]+/g, " ");
}

function treeToMermaid(treeData: ComponentTreeResult): string {
  const nodes = flattenTree(treeData.nodes);
  const ids = new Map(nodes.map((node, index) => [node.id, `n${index}`]));
  const lines = ["graph TD"];
  for (const node of nodes)
    lines.push(`  ${ids.get(node.id)}["${mermaidText(node.name)}"]`);
  for (const node of nodes) {
    const parent = node.parentId ? ids.get(node.parentId) : undefined;
    if (parent) lines.push(`  ${parent} --> ${ids.get(node.id)}`);
  }
  return lines.join("\n");
}

function cleanValue(value: unknown, active: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) return "[Circular]";
  active.add(value);
  try {
    if (Array.isArray(value))
      return value.map((item) => cleanValue(item, active));
    const record = value as UnknownRecord;
    switch (recognizedType(record)) {
      case "undefined":
        return null;
      case "number":
      case "bigint":
      case "date":
        return record.value;
      case "error":
        return { name: record.name, message: record.message };
      case "circular-reference":
        return `[Circular -> ${formatPath(record.targetPath as StatePath) || "$"}]`;
      case "store-reference":
        return { storeId: record.storeId, ...(record.appId ? { appId: record.appId } : {}) };
      case "map":
        return (record.entries as unknown[]).map((entry) =>
          cleanValue(entry, active),
        );
      case "set":
        return (record.values as unknown[]).map((item) => cleanValue(item, active));
      case "truncated":
        return cleanValue(record.preview, active);
      default:
        return Object.fromEntries(
          Object.entries(record).map(([key, child]) => [
            key,
            cleanValue(child, active),
          ]),
        );
    }
  } finally {
    active.delete(value);
  }
}

function toCleanJson(data: unknown): string {
  return JSON.stringify(cleanValue(data, new WeakSet()), null, 2) ?? "null";
}

export const probeFormatters: Readonly<ProbeFormatters> = Object.freeze({
  stateToPaths,
  toMarkdown,
  domToTable,
  treeToMermaid,
  toCleanJson,
});
