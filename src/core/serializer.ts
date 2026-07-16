import type {
  ProbeErrorCode,
  ProbeValue,
  ErrorProbeValue,
  StatePath,
  TruncatedProbeValue,
} from "../public-types";

export const INITIAL_SERIALIZATION_DEFAULTS = Object.freeze({
  maxDepth: 2,
  maxEntries: 25,
  maxStringLength: 500,
});

export const HARD_MAX_ENTRIES = 200;

class ProbeContractError extends Error {
  constructor(
    public readonly code: ProbeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ProbeOptionsError extends ProbeContractError {
  constructor(message: string) {
    super("INVALID_OPTIONS", message);
  }
}

export interface SerializeProbeValueOptions {
  maxDepth?: number;
  maxEntries?: number;
  maxStringLength?: number;
  path?: StatePath;
}

interface NormalizedOptions {
  maxDepth: number;
  maxEntries: number;
  maxStringLength: number;
}

export function errorValue(error: unknown): ErrorProbeValue {
  if (error instanceof Error)
    return { $type: "error", name: error.name, message: error.message };
  return { $type: "error", name: "Error", message: String(error) };
}

function truncate(
  kind: TruncatedProbeValue["kind"],
  path: StatePath,
  total: number,
  preview: ProbeValue,
  returned: number,
): TruncatedProbeValue {
  return {
    $type: "truncated",
    kind,
    path: [...path],
    total,
    returned,
    preview,
    nextOffset: returned < total ? returned : null,
  };
}

function normalizeOptions(
  options: SerializeProbeValueOptions,
): NormalizedOptions {
  const maxDepth = integerOption(
    options.maxDepth ?? INITIAL_SERIALIZATION_DEFAULTS.maxDepth,
    "maxDepth",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const maxEntries = integerOption(
    options.maxEntries ?? INITIAL_SERIALIZATION_DEFAULTS.maxEntries,
    "maxEntries",
    1,
    HARD_MAX_ENTRIES,
  );
  const maxStringLength = integerOption(
    options.maxStringLength ?? INITIAL_SERIALIZATION_DEFAULTS.maxStringLength,
    "maxStringLength",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  return {
    maxDepth,
    maxEntries,
    maxStringLength,
  };
}

function integerOption(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new ProbeOptionsError(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  return value;
}

export function serializeProbeValue(
  value: unknown,
  options: SerializeProbeValueOptions = {},
): ProbeValue {
  const normalized = normalizeOptions(options);
  const seen = new Map<object, StatePath>();
  return walk(value, options.path ?? [], 0, normalized, seen);
}

function walk(
  value: unknown,
  path: StatePath,
  depth: number,
  options: NormalizedOptions,
  seen: Map<object, StatePath>,
): ProbeValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > options.maxStringLength) {
      const preview = value.slice(0, options.maxStringLength);
      return truncate("string", path, value.length, preview, preview.length);
    }
    return value;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { $type: "number", value: "NaN" };
    if (value === Number.POSITIVE_INFINITY)
      return { $type: "number", value: "Infinity" };
    if (value === Number.NEGATIVE_INFINITY)
      return { $type: "number", value: "-Infinity" };
    return value;
  }
  if (typeof value === "undefined") return { $type: "undefined" };
  if (typeof value === "bigint")
    return { $type: "bigint", value: value.toString() };
  if (typeof value === "symbol") return String(value);
  if (typeof value === "function")
    return `[Function${value.name ? ` ${value.name}` : ""}]`;

  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isNaN(timestamp)
      ? { $type: "error", name: "RangeError", message: "Invalid Date" }
      : { $type: "date", value: value.toISOString() };
  }
  if (value instanceof Error) return errorValue(value);

  const previousPath = seen.get(value);
  if (previousPath)
    return { $type: "circular-reference", targetPath: [...previousPath] };
  seen.set(value, [...path]);

  if (value instanceof Map) {
    if (depth >= options.maxDepth)
      return truncate("object", path, value.size, {}, 0);
    const entries = Array.from(value.entries())
      .slice(0, options.maxEntries)
      .map(
        ([key, entryValue], index) =>
          [
            walk(key, [...path, index, "key"], depth + 1, options, seen),
            walk(
              entryValue,
              [...path, index, "value"],
              depth + 1,
              options,
              seen,
            ),
          ] as [ProbeValue, ProbeValue],
      );
    return { $type: "map", size: value.size, entries };
  }

  if (value instanceof Set) {
    if (depth >= options.maxDepth)
      return truncate("array", path, value.size, [], 0);
    const values = Array.from(value.values())
      .slice(0, options.maxEntries)
      .map((entryValue, index) =>
        walk(entryValue, [...path, index], depth + 1, options, seen),
      );
    return { $type: "set", size: value.size, values };
  }

  if (typeof Element !== "undefined" && value instanceof Element)
    return `[HTMLElement <${value.tagName.toLowerCase()}>]`;

  if (Array.isArray(value)) {
    if (depth >= options.maxDepth)
      return truncate("array", path, value.length, [], 0);
    const preview: ProbeValue[] = [];
    const returned = Math.min(value.length, options.maxEntries);
    for (let index = 0; index < returned; index++) {
      try {
        preview.push(
          walk(
            Reflect.get(value, index),
            [...path, index],
            depth + 1,
            options,
            seen,
          ),
        );
      } catch (error) {
        preview.push(errorValue(error));
      }
    }
    return value.length > options.maxEntries
      ? truncate("array", path, value.length, preview, preview.length)
      : preview;
  }

  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch (error) {
    return errorValue(error);
  }
  if (depth >= options.maxDepth)
    return truncate("object", path, keys.length, {}, 0);

  const selectedKeys = keys.slice(0, options.maxEntries);
  const preview: Record<string, ProbeValue> = Object.create(null) as Record<
    string,
    ProbeValue
  >;
  for (const key of selectedKeys) {
    try {
      preview[key] = walk(
        Reflect.get(value, key),
        [...path, key],
        depth + 1,
        options,
        seen,
      );
    } catch (error) {
      preview[key] = errorValue(error);
    }
  }
  return keys.length > options.maxEntries
    ? truncate("object", path, keys.length, preview, selectedKeys.length)
    : preview;
}
