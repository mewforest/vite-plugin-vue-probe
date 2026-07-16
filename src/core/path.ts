import type {
  ProbeErrorCode,
  ProbeValue,
  DetailedStateOptions,
  StatePage,
  StatePath,
} from "../public-types";
import {
  ProbeOptionsError,
  errorValue,
  HARD_MAX_ENTRIES,
  serializeProbeValue,
} from "./serializer";

export { ProbeOptionsError } from "./serializer";

const DETAIL_DEFAULTS = Object.freeze({
  maxDepth: 3,
  limit: 50,
  maxStringLength: 500,
});

class ProbeContractError extends Error {
  constructor(
    public readonly code: ProbeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ProbePathError extends ProbeContractError {
  constructor(path: StatePath) {
    super("PATH_NOT_FOUND", `State path not found: ${JSON.stringify(path)}`);
  }
}

export interface ResolvedDetailedValue {
  path: StatePath;
  value: ProbeValue;
  page?: StatePage;
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

function readPath(
  root: unknown,
  path: StatePath,
): { failed: boolean; value: unknown } {
  let current = root;
  for (let index = 0; index < path.length; index++) {
    const segment = path[index]!;
    if (
      (typeof current !== "object" && typeof current !== "function") ||
      current === null
    )
      throw new ProbePathError(path.slice(0, index + 1));
    try {
      if (!(segment in current))
        throw new ProbePathError(path.slice(0, index + 1));
      current = Reflect.get(current, segment);
    } catch (error) {
      if (error instanceof ProbePathError) throw error;
      return { failed: true, value: errorValue(error) };
    }
  }
  return { failed: false, value: current };
}

function page(
  offset: number,
  limit: number,
  returned: number,
  total: number,
): StatePage {
  return {
    offset,
    limit,
    returned,
    total,
    nextOffset: offset + returned < total ? offset + returned : null,
  };
}

export function resolveDetailedValue(
  root: unknown,
  path: StatePath,
  options: DetailedStateOptions = {},
): ResolvedDetailedValue {
  const offset = integerOption(
    options.offset ?? 0,
    "offset",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const limit = integerOption(
    options.limit ?? DETAIL_DEFAULTS.limit,
    "limit",
    1,
    HARD_MAX_ENTRIES,
  );
  const maxEntries = integerOption(
    options.maxEntries ?? limit,
    "maxEntries",
    1,
    HARD_MAX_ENTRIES,
  );
  const maxDepth = integerOption(
    options.maxDepth ?? DETAIL_DEFAULTS.maxDepth,
    "maxDepth",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const maxStringLength = integerOption(
    options.maxStringLength ?? DETAIL_DEFAULTS.maxStringLength,
    "maxStringLength",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const resolved = readPath(root, path);
  if (resolved.failed)
    return { path: [...path], value: resolved.value as ProbeValue };
  const value = resolved.value;

  const serialize = (item: unknown, itemPath: StatePath): ProbeValue =>
    serializeProbeValue(item, {
      maxDepth,
      maxEntries,
      maxStringLength,
      path: itemPath,
    });

  if (Array.isArray(value)) {
    const selected: ProbeValue[] = [];
    const end = Math.min(value.length, offset + limit);
    for (let index = offset; index < end; index++) {
      try {
        selected.push(serialize(Reflect.get(value, index), [...path, index]));
      } catch (error) {
        selected.push(errorValue(error));
      }
    }
    return {
      path: [...path],
      value: selected,
      page: page(offset, limit, selected.length, value.length),
    };
  }

  if (typeof value === "string") {
    const selected = value.slice(offset, offset + limit);
    return {
      path: [...path],
      value: selected,
      page: page(offset, limit, selected.length, value.length),
    };
  }

  if (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Date) &&
    !(value instanceof Map) &&
    !(value instanceof Set)
  ) {
    const keys = Object.keys(value);
    const selectedKeys = keys.slice(offset, offset + limit);
    const selected: Record<string, ProbeValue> = Object.create(null) as Record<
      string,
      ProbeValue
    >;
    for (const key of selectedKeys) {
      try {
        selected[key] = serialize(Reflect.get(value, key), [...path, key]);
      } catch (error) {
        selected[key] = errorValue(error);
      }
    }
    return {
      path: [...path],
      value: selected,
      page: page(offset, limit, selectedKeys.length, keys.length),
    };
  }

  return { path: [...path], value: serialize(value, path) };
}
