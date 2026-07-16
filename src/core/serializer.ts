import type {
  ErrorProbeValue,
  MapProbeValue,
  ProbeValue,
  SerializationBudget,
  SetProbeValue,
  StatePath,
  TruncatedProbeValue,
} from "../public-types.js";
import {
  HARD_MAX_NODES,
  HARD_MAX_PATH_SEGMENT_LENGTH,
  HARD_MAX_TOTAL_STRING_LENGTH,
  SERIALIZATION_DEFAULTS,
  normalizeSerializationOptions,
  type NormalizedSerializationOptions,
} from "./contract.js";

export interface SerializeProbeValueOptions extends SerializationBudget {
  path?: StatePath;
}

export interface SerializationContext {
  readonly options: NormalizedSerializationOptions;
  readonly maxNodes: number;
  nodesUsed: number;
  readonly maxStringCharacters: number;
  stringCharactersUsed: number;
}

export interface ProbePayloadBudget {
  remainingNodes: number;
  remainingStringCharacters: number;
  terminalEmitted: boolean;
}

export interface BoundProbePayload {
  value: ProbeValue | undefined;
  terminal: boolean;
}

export function createSerializationContext(
  options: SerializationBudget = {},
): SerializationContext {
  return {
    options: normalizeSerializationOptions(options),
    maxNodes: HARD_MAX_NODES,
    nodesUsed: 0,
    maxStringCharacters: HARD_MAX_TOTAL_STRING_LENGTH,
    stringCharactersUsed: 0,
  };
}

export function createProbePayloadBudget(): ProbePayloadBudget {
  return {
    remainingNodes: HARD_MAX_NODES,
    remainingStringCharacters: HARD_MAX_TOTAL_STRING_LENGTH,
    terminalEmitted: false,
  };
}

export function isSerializationExhausted(
  context: SerializationContext,
): boolean {
  return (
    context.nodesUsed >= context.maxNodes ||
    context.stringCharactersUsed >= context.maxStringCharacters
  );
}

function clampGeneratedString(value: string, maximum: number): string {
  return value.length > maximum ? value.slice(0, maximum) : value;
}

function safeString(
  value: unknown,
  maximum: number,
  fallback: string,
): string {
  try {
    return clampGeneratedString(String(value), maximum);
  } catch {
    return clampGeneratedString(fallback, maximum);
  }
}

export function errorValue(
  error: unknown,
  maximum: number = SERIALIZATION_DEFAULTS.maxStringLength,
): ErrorProbeValue {
  let name = "Error";
  let message = "Unknown error";
  if (
    (typeof error === "object" && error !== null) ||
    typeof error === "function"
  ) {
    try {
      const candidate = safeString(Reflect.get(error, "name"), maximum, "Error");
      if (candidate) name = candidate;
    } catch {
      // Hostile Error-like objects must not escape the JSON-safe boundary.
    }
    try {
      message = safeString(
        Reflect.get(error, "message"),
        maximum,
        "Unknown error",
      );
    } catch {
      // Keep the stable fallback.
    }
  } else {
    message = safeString(error, maximum, "Unknown error");
  }
  return {
    $type: "error",
    name: clampGeneratedString(name, maximum),
    message: clampGeneratedString(message, maximum),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isNextOffset(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

function isStatePath(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (segment) => typeof segment === "string" || Number.isInteger(segment),
    )
  );
}

function isMapProbeValue(
  value: Record<string, unknown>,
): value is Record<string, unknown> & MapProbeValue {
  return (
    value.$type === "map" &&
    hasExactKeys(value, ["$type", "size", "entries", "returned", "nextOffset"]) &&
    isNonNegativeInteger(value.size) &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry) => Array.isArray(entry) && entry.length === 2,
    ) &&
    isNonNegativeInteger(value.returned) &&
    value.returned <= value.entries.length &&
    isNextOffset(value.nextOffset)
  );
}

function isSetProbeValue(
  value: Record<string, unknown>,
): value is Record<string, unknown> & SetProbeValue {
  return (
    value.$type === "set" &&
    hasExactKeys(value, ["$type", "size", "values", "returned", "nextOffset"]) &&
    isNonNegativeInteger(value.size) &&
    Array.isArray(value.values) &&
    isNonNegativeInteger(value.returned) &&
    value.returned <= value.values.length &&
    isNextOffset(value.nextOffset)
  );
}

function isTruncatedProbeValue(
  value: Record<string, unknown>,
): value is Record<string, unknown> & TruncatedProbeValue {
  return (
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
    ["array", "object", "string"].includes(value.kind as string) &&
    isStatePath(value.path) &&
    isNonNegativeInteger(value.total) &&
    isNonNegativeInteger(value.returned) &&
    value.returned <= value.total &&
    isNextOffset(value.nextOffset) &&
    (value.reason === undefined ||
      value.reason === "node-budget" ||
      value.reason === "string-budget" ||
      value.reason === "key-length")
  );
}

function isLeafSpecialValue(value: Record<string, unknown>): boolean {
  switch (value.$type) {
    case "undefined":
      return hasExactKeys(value, ["$type"]);
    case "number":
      return (
        hasExactKeys(value, ["$type", "value"]) &&
        ["NaN", "Infinity", "-Infinity"].includes(value.value as string)
      );
    case "bigint":
      return (
        hasExactKeys(value, ["$type", "value"], ["truncated", "totalDigits"]) &&
        typeof value.value === "string" &&
        (value.truncated === undefined || value.truncated === true) &&
        (value.totalDigits === undefined || isNonNegativeInteger(value.totalDigits))
      );
    case "date":
      return hasExactKeys(value, ["$type", "value"]) && typeof value.value === "string";
    case "error":
      return (
        hasExactKeys(value, ["$type", "name", "message"]) &&
        typeof value.name === "string" &&
        typeof value.message === "string"
      );
    case "circular-reference":
      return hasExactKeys(value, ["$type", "targetPath"]) && isStatePath(value.targetPath);
    case "store-reference":
      return (
        hasExactKeys(value, ["$type", "storeId"], ["appId"]) &&
        typeof value.storeId === "string" &&
        (value.appId === undefined || typeof value.appId === "string")
      );
    default:
      return false;
  }
}

function logicalProbeNodes(
  value: unknown,
  stack: WeakSet<object> = new WeakSet(),
): number {
  if (value === null || typeof value !== "object") return 1;
  if (stack.has(value)) return 1;
  stack.add(value);
  try {
    if (Array.isArray(value))
      return (
        1 +
        value.reduce<number>(
          (total, item) => total + logicalProbeNodes(item, stack),
          0,
        )
      );
    if (!isRecord(value)) return 1;
    if (isMapProbeValue(value))
      return (
        1 +
        value.entries.reduce<number>(
          (total, [key, item]) =>
            total +
            logicalProbeNodes(key, stack) +
            logicalProbeNodes(item, stack),
          0,
        )
      );
    if (isSetProbeValue(value))
      return (
        1 +
        value.values.reduce<number>(
          (total, item) => total + logicalProbeNodes(item, stack),
          0,
        )
      );
    if (isTruncatedProbeValue(value))
      return 1 + logicalProbeNodes(value.preview, stack);
    if (isLeafSpecialValue(value)) return 1;
    return (
      1 +
      Object.values(value).reduce<number>(
        (total, item) => total + logicalProbeNodes(item, stack),
        0,
      )
    );
  } catch {
    return HARD_MAX_NODES + 1;
  } finally {
    stack.delete(value);
  }
}

function logicalProbeStringCharacters(
  value: unknown,
  stack: WeakSet<object> = new WeakSet(),
): number {
  if (typeof value === "string") return value.length;
  if (value === null || typeof value !== "object") return 0;
  if (stack.has(value)) return HARD_MAX_TOTAL_STRING_LENGTH + 1;
  stack.add(value);
  try {
    if (Array.isArray(value))
      return value.reduce<number>(
        (total, item) => total + logicalProbeStringCharacters(item, stack),
        0,
      );
    return Object.entries(value).reduce<number>(
      (total, [key, item]) =>
        total + key.length + logicalProbeStringCharacters(item, stack),
      0,
    );
  } catch {
    return HARD_MAX_TOTAL_STRING_LENGTH + 1;
  } finally {
    stack.delete(value);
  }
}

function terminalTruncation(
  path: StatePath,
  reason: "node-budget" | "string-budget" = "node-budget",
): TruncatedProbeValue {
  return {
    $type: "truncated",
    kind: "object",
    path: [...path],
    total: 0,
    returned: 0,
    preview: null,
    nextOffset: null,
    reason,
  };
}

export function boundProbePayload(
  value: ProbeValue,
  path: StatePath,
  budget: ProbePayloadBudget,
): BoundProbePayload {
  if (budget.terminalEmitted) return { value: undefined, terminal: true };
  const nodes = logicalProbeNodes(value);
  const stringCharacters = logicalProbeStringCharacters(value);
  const normalCapacity = Math.max(0, budget.remainingNodes - 2);
  if (
    nodes <= normalCapacity &&
    stringCharacters <= budget.remainingStringCharacters
  ) {
    budget.remainingNodes -= nodes;
    budget.remainingStringCharacters -= stringCharacters;
    return { value, terminal: false };
  }
  budget.terminalEmitted = true;
  if (budget.remainingNodes < 2) {
    budget.remainingNodes = 0;
    return { value: undefined, terminal: true };
  }
  budget.remainingNodes -= 2;
  return {
    value: terminalTruncation(
      path,
      stringCharacters > budget.remainingStringCharacters
        ? "string-budget"
        : "node-budget",
    ),
    terminal: true,
  };
}

export function claimProbePayloadStrings(
  budget: ProbePayloadBudget,
  values: readonly string[],
): boolean {
  const characters = values.reduce((total, value) => total + value.length, 0);
  if (characters > budget.remainingStringCharacters) return false;
  budget.remainingStringCharacters -= characters;
  return true;
}

function truncate(
  kind: TruncatedProbeValue["kind"],
  path: StatePath,
  total: number,
  preview: ProbeValue,
  returned: number,
  nextOffset = returned < total ? returned : null,
): TruncatedProbeValue {
  return {
    $type: "truncated",
    kind,
    path: [...path],
    total,
    returned,
    preview,
    nextOffset,
  };
}

function serializeStringValue(
  value: string,
  path: StatePath,
  context: SerializationContext,
): ProbeValue {
  const perValueLength = Math.min(value.length, context.options.maxStringLength);
  const remainingCharacters = Math.max(
    0,
    context.maxStringCharacters - context.stringCharactersUsed,
  );
  const returned = Math.min(perValueLength, remainingCharacters);
  const preview = value.slice(0, returned);
  context.stringCharactersUsed += returned;
  if (returned === value.length) return preview;
  return {
    ...truncate("string", path, value.length, preview, returned),
    ...(returned < perValueLength ? { reason: "string-budget" as const } : {}),
  };
}

function consumeGeneratedString(
  context: SerializationContext,
  value: string,
): boolean {
  const remainingCharacters =
    context.maxStringCharacters - context.stringCharactersUsed;
  if (value.length > remainingCharacters) return false;
  context.stringCharactersUsed += value.length;
  return true;
}

function contextualErrorValue(
  error: unknown,
  path: StatePath,
  context: SerializationContext,
): ProbeValue {
  const serialized = errorValue(error, context.options.maxStringLength);
  if (
    consumeGeneratedString(context, serialized.name) &&
    consumeGeneratedString(context, serialized.message)
  )
    return serialized;
  return {
    ...truncate("object", path, 2, null, 0, null),
    reason: "string-budget",
  };
}

function remaining(context: SerializationContext, reserve = 0): number {
  return context.maxNodes - context.nodesUsed - reserve;
}

function consume(context: SerializationContext, reserve = 0): boolean {
  if (remaining(context, reserve) <= 0) return false;
  context.nodesUsed += 1;
  return true;
}

function safeSize(value: Map<unknown, unknown> | Set<unknown>): number {
  try {
    return value.size;
  } catch {
    return 0;
  }
}

function budgetTruncation(value: unknown, path: StatePath): TruncatedProbeValue {
  if (typeof value === "string")
    return truncate("string", path, value.length, "", 0);
  if (Array.isArray(value) || value instanceof Set)
    return truncate(
      "array",
      path,
      Array.isArray(value) ? value.length : safeSize(value),
      [],
      0,
    );
  if (value instanceof Map)
    return truncate("object", path, safeSize(value), {}, 0);
  if (typeof value === "object" && value !== null) {
    let total = 0;
    try {
      total = Object.keys(value).length;
    } catch {
      // The budget is already exhausted; do not replace truncation with a trap.
    }
    return truncate("object", path, total, {}, 0);
  }
  return truncate("object", path, 1, {}, 0);
}

export function serializeProbeValue(
  value: unknown,
  options: SerializeProbeValueOptions = {},
  context?: SerializationContext,
): ProbeValue {
  const activeContext = context ?? createSerializationContext(options);
  return walk(value, options.path ?? [], 0, activeContext, new Map());
}

export function serializeProbeRecord(
  value: Record<string, unknown>,
  path: StatePath,
  context: SerializationContext,
): ProbeValue {
  return walk(value, path, -1, context, new Map());
}

function walk(
  value: unknown,
  path: StatePath,
  depth: number,
  context: SerializationContext,
  stack: Map<object, StatePath>,
  reserve = 0,
): ProbeValue {
  if (!consume(context, reserve)) return budgetTruncation(value, path);
  const options = context.options;

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string")
    return serializeStringValue(value, path, context);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { $type: "number", value: "NaN" };
    if (value === Number.POSITIVE_INFINITY)
      return { $type: "number", value: "Infinity" };
    if (value === Number.NEGATIVE_INFINITY)
      return { $type: "number", value: "-Infinity" };
    return value;
  }
  if (typeof value === "undefined") return { $type: "undefined" };
  if (typeof value === "bigint") {
    const decimal = value.toString();
    const totalDigits = decimal.startsWith("-")
      ? decimal.length - 1
      : decimal.length;
    const perValueLength = Math.min(decimal.length, options.maxStringLength);
    const available = Math.max(
      0,
      context.maxStringCharacters - context.stringCharactersUsed,
    );
    const returned = Math.min(perValueLength, available);
    const serializedDecimal = decimal.slice(0, returned);
    context.stringCharactersUsed += returned;
    if (returned < perValueLength)
      return {
        ...truncate("string", path, decimal.length, serializedDecimal, returned),
        reason: "string-budget",
      };
    return decimal.length > returned
      ? {
          $type: "bigint",
          value: serializedDecimal,
          truncated: true,
          totalDigits,
        }
      : { $type: "bigint", value: serializedDecimal };
  }
  if (typeof value === "symbol")
    return serializeStringValue(
      safeString(value, options.maxStringLength, "Symbol()"),
      path,
      context,
    );
  if (typeof value === "function") {
    let name = "";
    try {
      const candidate = Reflect.get(value, "name");
      if (typeof candidate === "string")
        name = candidate.slice(0, options.maxStringLength);
    } catch {
      // A callable Proxy may trap name access.
    }
    return serializeStringValue(
      clampGeneratedString(
        `[Function${name ? ` ${name}` : ""}]`,
        options.maxStringLength,
      ),
      path,
      context,
    );
  }

  if (value instanceof Date) {
    const timestamp = value.getTime();
    if (Number.isNaN(timestamp))
      return contextualErrorValue(new RangeError("Invalid Date"), path, context);
    const iso = value.toISOString();
    return consumeGeneratedString(context, iso)
      ? { $type: "date", value: iso }
      : {
          ...truncate("string", path, iso.length, "", 0),
          reason: "string-budget",
        };
  }
  if (value instanceof Error) return contextualErrorValue(value, path, context);
  if (typeof Element !== "undefined" && value instanceof Element) {
    let tag = "unknown";
    try {
      tag = safeString(
        Reflect.get(value, "tagName"),
        options.maxStringLength,
        "unknown",
      ).toLowerCase();
    } catch {
      // Keep the stable fallback for hostile DOM-like values.
    }
    return serializeStringValue(
      clampGeneratedString(
        `[HTMLElement <${tag}>]`,
        options.maxStringLength,
      ),
      path,
      context,
    );
  }

  if (
    depth >= 0 &&
    isRecord(value) &&
    value.$type === "store-reference" &&
    hasExactKeys(value, ["$type", "storeId"], ["appId"]) &&
    typeof value.storeId === "string" &&
    (value.appId === undefined || typeof value.appId === "string")
  ) {
    if (
      value.storeId.length > options.maxStringLength ||
      (typeof value.appId === "string" &&
        value.appId.length > options.maxStringLength)
    )
      return {
        $type: "truncated",
        kind: "object",
        path: [...path],
        total: value.appId === undefined ? 2 : 3,
        returned: 0,
        preview: null,
        nextOffset: null,
      };
    if (
      !consumeGeneratedString(context, value.storeId) ||
      (typeof value.appId === "string" &&
        !consumeGeneratedString(context, value.appId))
    )
      return {
        ...truncate(
          "object",
          path,
          value.appId === undefined ? 2 : 3,
          null,
          0,
          null,
        ),
        reason: "string-budget",
      };
    return {
      $type: "store-reference",
      storeId: value.storeId,
      ...(value.appId === undefined ? {} : { appId: value.appId }),
    };
  }

  const previousPath = stack.get(value);
  if (previousPath !== undefined)
    return { $type: "circular-reference", targetPath: [...previousPath] };
  stack.set(value, [...path]);
  try {
    if (value instanceof Map)
      return serializeMapValue(value, path, depth, context, stack, reserve);
    if (value instanceof Set)
      return serializeSetValue(value, path, depth, context, stack, reserve);
    if (Array.isArray(value))
      return serializeArrayValue(value, path, depth, context, stack, reserve);
    return serializeObjectValue(value, path, depth, context, stack, reserve);
  } finally {
    stack.delete(value);
  }
}

function serializeMapValue(
  value: Map<unknown, unknown>,
  path: StatePath,
  depth: number,
  context: SerializationContext,
  stack: Map<object, StatePath>,
  reserve: number,
): ProbeValue {
  let size: number;
  try {
    size = value.size;
  } catch (error) {
    return contextualErrorValue(error, path, context);
  }
  if (depth >= context.options.maxDepth)
    return truncate("object", path, size, {}, 0);

  let iterator: Iterator<[unknown, unknown]>;
  try {
    iterator = value.entries();
  } catch (error) {
    return contextualErrorValue(error, path, context);
  }
  const raw: Array<[unknown, unknown]> = [];
  let hasMore = false;
  try {
    for (let index = 0; index < context.options.maxEntries; index++) {
      const item = iterator.next();
      if (item.done) break;
      raw.push(item.value);
    }
    if (raw.length === context.options.maxEntries)
      hasMore = !iterator.next().done;
  } catch (error) {
    return contextualErrorValue(error, path, context);
  }

  const entries: Array<[ProbeValue, ProbeValue]> = [];
  for (let index = 0; index < raw.length; index++) {
    if (remaining(context, reserve) < 2) break;
    const [key, entryValue] = raw[index]!;
    const serializedKey = walk(
      key,
      [...path, index, "key"],
      depth + 1,
      context,
      stack,
      reserve + 1,
    );
    const serializedValue = walk(
      entryValue,
      [...path, index, "value"],
      depth + 1,
      context,
      stack,
      reserve,
    );
    entries.push([serializedKey, serializedValue]);
  }
  return {
    $type: "map",
    size,
    entries,
    returned: entries.length,
    nextOffset:
      entries.length > 0 && (entries.length < raw.length || hasMore)
        ? entries.length
        : null,
  };
}

function serializeSetValue(
  value: Set<unknown>,
  path: StatePath,
  depth: number,
  context: SerializationContext,
  stack: Map<object, StatePath>,
  reserve: number,
): ProbeValue {
  let size: number;
  try {
    size = value.size;
  } catch (error) {
    return contextualErrorValue(error, path, context);
  }
  if (depth >= context.options.maxDepth)
    return truncate("array", path, size, [], 0);

  let iterator: Iterator<unknown>;
  try {
    iterator = value.values();
  } catch (error) {
    return contextualErrorValue(error, path, context);
  }
  const raw: unknown[] = [];
  let hasMore = false;
  try {
    for (let index = 0; index < context.options.maxEntries; index++) {
      const item = iterator.next();
      if (item.done) break;
      raw.push(item.value);
    }
    if (raw.length === context.options.maxEntries)
      hasMore = !iterator.next().done;
  } catch (error) {
    return contextualErrorValue(error, path, context);
  }

  const values: ProbeValue[] = [];
  for (let index = 0; index < raw.length; index++) {
    if (remaining(context, reserve) <= 0) break;
    values.push(
      walk(
        raw[index],
        [...path, index],
        depth + 1,
        context,
        stack,
        reserve,
      ),
    );
  }
  return {
    $type: "set",
    size,
    values,
    returned: values.length,
    nextOffset:
      values.length > 0 && (values.length < raw.length || hasMore)
        ? values.length
        : null,
  };
}

function serializeArrayValue(
  value: unknown[],
  path: StatePath,
  depth: number,
  context: SerializationContext,
  stack: Map<object, StatePath>,
  reserve: number,
): ProbeValue {
  if (depth >= context.options.maxDepth)
    return truncate("array", path, value.length, [], 0);
  const preview: ProbeValue[] = [];
  const selected = Math.min(value.length, context.options.maxEntries);
  for (let index = 0; index < selected; index++) {
    if (remaining(context, reserve) <= 0) break;
    try {
      preview.push(
        walk(
          Reflect.get(value, index),
          [...path, index],
          depth + 1,
          context,
          stack,
          reserve,
        ),
      );
    } catch (error) {
      if (!consume(context, reserve)) break;
      preview.push(contextualErrorValue(error, [...path, index], context));
    }
  }
  return preview.length < value.length
    ? truncate("array", path, value.length, preview, preview.length)
    : preview;
}

function serializeObjectValue(
  value: object,
  path: StatePath,
  depth: number,
  context: SerializationContext,
  stack: Map<object, StatePath>,
  reserve: number,
): ProbeValue {
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch (error) {
    return contextualErrorValue(error, path, context);
  }
  if (keys.some((key) => key.length > HARD_MAX_PATH_SEGMENT_LENGTH))
    return {
      $type: "truncated",
      kind: "object",
      path: [...path],
      total: keys.length,
      returned: 0,
      preview: null,
      nextOffset: null,
      reason: "key-length",
    };
  if (depth >= context.options.maxDepth)
    return truncate("object", path, keys.length, {}, 0);

  const preview: Record<string, ProbeValue> = Object.create(null) as Record<
    string,
    ProbeValue
  >;
  const selected = Math.min(keys.length, context.options.maxEntries);
  for (let index = 0; index < selected; index++) {
    if (remaining(context, reserve) <= 0) break;
    const key = keys[index]!;
    if (!consumeGeneratedString(context, key))
      return {
        ...truncate(
          "object",
          path,
          keys.length,
          preview,
          Object.keys(preview).length,
        ),
        reason: "string-budget",
      };
    try {
      preview[key] = walk(
        Reflect.get(value, key),
        [...path, key],
        depth + 1,
        context,
        stack,
        reserve,
      );
    } catch (error) {
      if (!consume(context, reserve)) break;
      preview[key] = contextualErrorValue(error, [...path, key], context);
    }
  }
  const returned = Object.keys(preview).length;
  return returned < keys.length
    ? truncate("object", path, keys.length, preview, returned)
    : preview;
}
