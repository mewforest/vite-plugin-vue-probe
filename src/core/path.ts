import type {
  ProbeValue,
  DetailedStateOptions,
  StatePage,
  StatePath,
} from "../public-types.js";
import {
  boundProbePayload,
  createProbePayloadBudget,
  createSerializationContext,
  errorValue,
  isSerializationExhausted,
  serializeProbeValue,
  type ProbePayloadBudget,
} from "./serializer.js";
import {
  DETAIL_DEFAULTS,
  HARD_MAX_DEPTH,
  HARD_MAX_ENTRIES,
  HARD_MAX_OFFSET,
  HARD_MAX_PATH_SEGMENT_LENGTH,
  HARD_MAX_PATH_SEGMENTS,
  HARD_MAX_PATH_TOTAL_LENGTH,
  HARD_MAX_STRING_LENGTH,
  ProbeContractError,
  ProbeOptionsError,
  integerOption,
} from "./contract.js";

export class ProbePathError extends ProbeContractError {
  constructor(
    path: StatePath,
    maximum: number = DETAIL_DEFAULTS.maxStringLength,
  ) {
    const prefix = "State path not found: ";
    const rendered = renderPath(path, Math.max(0, maximum - prefix.length));
    super(
      "PATH_NOT_FOUND",
      `${prefix}${rendered}`.slice(0, maximum),
    );
  }
}

function renderPath(path: StatePath, maximum: number): string {
  let rendered = "[";
  const segments = Math.min(path.length, HARD_MAX_PATH_SEGMENTS);
  for (let index = 0; index < segments && rendered.length < maximum; index++) {
    if (index > 0) rendered += ",";
    const segment = path[index]!;
    if (typeof segment === "number") {
      rendered += String(segment);
      continue;
    }
    const remaining = Math.max(0, maximum - rendered.length - 2);
    rendered += JSON.stringify(
      segment.slice(0, Math.min(HARD_MAX_PATH_SEGMENT_LENGTH, remaining)),
    );
  }
  if (rendered.length < maximum) rendered += "]";
  return rendered.slice(0, maximum);
}

export function normalizeStatePath(path: StatePath): StatePath {
  if (!Array.isArray(path) || path.length > HARD_MAX_PATH_SEGMENTS)
    throw new ProbeOptionsError(
      `path must contain at most ${HARD_MAX_PATH_SEGMENTS} segments`,
    );
  const normalized: StatePath = [];
  let totalStringLength = 0;
  for (const segment of path) {
    if (typeof segment === "string") {
      if (segment.length > HARD_MAX_PATH_SEGMENT_LENGTH)
        throw new ProbeOptionsError(
          `path string segments must contain at most ${HARD_MAX_PATH_SEGMENT_LENGTH} characters`,
        );
      totalStringLength += segment.length;
      if (totalStringLength > HARD_MAX_PATH_TOTAL_LENGTH)
        throw new ProbeOptionsError(
          `path strings must contain at most ${HARD_MAX_PATH_TOTAL_LENGTH} characters in total`,
        );
      normalized.push(segment);
    } else if (
      typeof segment === "number" &&
      Number.isInteger(segment) &&
      segment >= 0 &&
      segment <= HARD_MAX_OFFSET
    ) {
      normalized.push(segment);
    } else {
      throw new ProbeOptionsError("path segments must be strings or addressable integers");
    }
  }
  return normalized;
}

export interface ResolvedDetailedValue {
  path: StatePath;
  value: ProbeValue;
  page?: StatePage;
}

export interface NormalizedDetailedOptions {
  offset: number;
  limit: number;
  maxEntries: number;
  maxDepth: number;
  maxStringLength: number;
}

function validCollectionIndex(segment: string | number): segment is number {
  return (
    typeof segment === "number" &&
    Number.isInteger(segment) &&
    segment >= 0 &&
    segment <= HARD_MAX_OFFSET
  );
}

function readIteratorIndex<T>(
  iterator: Iterator<T>,
  index: number,
): { found: true; value: T } | { found: false } {
  for (let current = 0; current <= index; current++) {
    const item = iterator.next();
    if (item.done) return { found: false };
    if (current === index) return { found: true, value: item.value };
  }
  return { found: false };
}

function readPath(
  root: unknown,
  path: StatePath,
  maxStringLength: number,
): { failed: boolean; value: unknown } {
  let current = root;
  for (let index = 0; index < path.length; index++) {
    const segment = path[index]!;
    if (
      (typeof current !== "object" && typeof current !== "function") ||
      current === null
    )
      throw new ProbePathError(path.slice(0, index + 1), maxStringLength);
    try {
      if (current instanceof Map) {
        if (!validCollectionIndex(segment))
          throw new ProbePathError(path.slice(0, index + 1), maxStringLength);
        if (segment >= current.size)
          throw new ProbePathError(path.slice(0, index + 1), maxStringLength);
        const entry = readIteratorIndex(current.entries(), segment);
        if (!entry.found)
          throw new ProbePathError(path.slice(0, index + 1), maxStringLength);
        current = Object.assign(Object.create(null) as object, {
          key: entry.value[0],
          value: entry.value[1],
        });
        continue;
      }
      if (current instanceof Set) {
        if (!validCollectionIndex(segment))
          throw new ProbePathError(path.slice(0, index + 1), maxStringLength);
        if (segment >= current.size)
          throw new ProbePathError(path.slice(0, index + 1), maxStringLength);
        const item = readIteratorIndex(current.values(), segment);
        if (!item.found)
          throw new ProbePathError(path.slice(0, index + 1), maxStringLength);
        current = item.value;
        continue;
      }
      if (
        Array.isArray(current) &&
        typeof segment === "number" &&
        (!Number.isInteger(segment) || segment < 0 || segment >= 2 ** 32 - 1)
      )
        throw new ProbePathError(path.slice(0, index + 1), maxStringLength);
      if (!Object.hasOwn(current, segment))
        throw new ProbePathError(path.slice(0, index + 1), maxStringLength);
      current = Reflect.get(current, segment);
    } catch (error) {
      if (error instanceof ProbePathError) throw error;
      return {
        failed: true,
        value: errorValue(error, maxStringLength),
      };
    }
  }
  return { failed: false, value: current };
}

function iteratorPage<T>(
  iterator: Iterator<T>,
  offset: number,
  limit: number,
  maxStringLength: number,
):
  | { ok: true; values: T[]; hasMore: boolean }
  | { ok: false; error: ProbeValue } {
  const selected: T[] = [];
  try {
    let index = 0;
    while (index < offset) {
      const item = iterator.next();
      if (item.done) return { ok: true, values: [], hasMore: false };
      index += 1;
    }
    while (selected.length < limit) {
      const item = iterator.next();
      if (item.done) return { ok: true, values: selected, hasMore: false };
      selected.push(item.value);
    }
    return {
      ok: true,
      values: selected,
      hasMore: !iterator.next().done,
    };
  } catch (error) {
    return {
      ok: false,
      error: errorValue(error, maxStringLength),
    };
  }
}

function page(
  offset: number,
  limit: number,
  returned: number,
  total: number,
  nextOffset?: number | null,
): StatePage {
  const candidate = offset + returned;
  return {
    offset,
    limit,
    returned,
    total,
    nextOffset:
      nextOffset === undefined
        ? candidate < total && candidate <= HARD_MAX_OFFSET
          ? candidate
          : null
        : nextOffset,
  };
}

export function normalizeDetailedOptions(
  options: DetailedStateOptions = {},
): NormalizedDetailedOptions {
  const defaultLimit = options.bypassBudgets
    ? HARD_MAX_ENTRIES
    : DETAIL_DEFAULTS.limit;
  const defaultDepth = options.bypassBudgets
    ? HARD_MAX_DEPTH
    : DETAIL_DEFAULTS.maxDepth;
  const defaultStringLength = options.bypassBudgets
    ? HARD_MAX_STRING_LENGTH
    : DETAIL_DEFAULTS.maxStringLength;
  const offset = integerOption(options.offset ?? 0, "offset", 0, HARD_MAX_OFFSET);
  const limit = integerOption(
    options.limit ?? defaultLimit,
    "limit",
    1,
    HARD_MAX_ENTRIES,
  );
  if (!Number.isSafeInteger(offset + limit))
    throw new ProbeOptionsError("offset + limit must be a safe integer");
  return {
    offset,
    limit,
    maxEntries: integerOption(
      options.maxEntries ?? limit,
      "maxEntries",
      1,
      HARD_MAX_ENTRIES,
    ),
    maxDepth: integerOption(
      options.maxDepth ?? defaultDepth,
      "maxDepth",
      0,
      HARD_MAX_DEPTH,
    ),
    maxStringLength: integerOption(
      options.maxStringLength ?? defaultStringLength,
      "maxStringLength",
      1,
      HARD_MAX_STRING_LENGTH,
    ),
  };
}

export function resolveDetailedValue(
  root: unknown,
  path: StatePath,
  options: DetailedStateOptions = {},
  payloadBudget: ProbePayloadBudget = createProbePayloadBudget(),
): ResolvedDetailedValue {
  const normalizedPath = normalizeStatePath(path);
  const { offset, limit, maxEntries, maxDepth, maxStringLength } =
    normalizeDetailedOptions(options);
  const resolved = readPath(root, normalizedPath, maxStringLength);
  if (resolved.failed)
    return { path: [...normalizedPath], value: resolved.value as ProbeValue };
  path = normalizedPath;
  const value = resolved.value;

  const context = createSerializationContext({
    maxDepth,
    maxEntries,
    maxStringLength,
  });
  const addressableLimit = Math.min(
    limit,
    HARD_MAX_OFFSET - offset + 1,
  );
  const serialize = (item: unknown, itemPath: StatePath): ProbeValue =>
    serializeProbeValue(item, { path: itemPath }, context);
  const bounded = (item: ProbeValue) => boundProbePayload(item, path, payloadBudget);

  if (Array.isArray(value)) {
    const selected: ProbeValue[] = [];
    const end = Math.min(value.length, offset + addressableLimit);
    for (let index = offset; index < end; index++) {
      if (isSerializationExhausted(context)) break;
      try {
        selected.push(serialize(Reflect.get(value, index), [...path, index]));
      } catch (error) {
        selected.push(errorValue(error, maxStringLength));
      }
    }
    const delivered = bounded(selected);
    const returned = delivered.terminal ? 0 : selected.length;
    return {
      path: [...path],
      value: delivered.value!,
      page: page(offset, limit, returned, value.length, returned > 0 ? undefined : null),
    };
  }

  if (typeof value === "string") {
    const selected = value.slice(offset, offset + addressableLimit);
    const delivered = bounded(selected);
    const returned =
      !delivered.terminal && typeof delivered.value === "string"
        ? delivered.value.length
        : 0;
    return {
      path: [...path],
      value: delivered.value!,
      page: page(offset, limit, returned, value.length, returned > 0 ? undefined : null),
    };
  }

  if (value instanceof Map) {
    let size: number;
    let iterator: Iterator<[unknown, unknown]>;
    try {
      size = value.size;
      if (offset >= size) {
        const empty: ProbeValue = {
          $type: "map",
          size,
          entries: [],
          returned: 0,
          nextOffset: null,
        };
        return {
          path: [...path],
          value: bounded(empty).value!,
          page: page(offset, limit, 0, size, null),
        };
      }
      iterator = value.entries();
    } catch (error) {
      return {
        path: [...path],
        value: errorValue(error, maxStringLength),
      };
    }
    const selected = iteratorPage(
      iterator,
      offset,
      addressableLimit,
      maxStringLength,
    );
    if (!selected.ok) return { path: [...path], value: selected.error };
    const entries: Array<[ProbeValue, ProbeValue]> = [];
    for (let index = 0; index < selected.values.length; index++) {
      if (isSerializationExhausted(context)) break;
      const [key, entryValue] = selected.values[index]!;
      const sourceIndex = offset + index;
      entries.push([
        serialize(key, [...path, sourceIndex, "key"]),
        serialize(entryValue, [...path, sourceIndex, "value"]),
      ]);
    }
    const deliveredEntries = entries;
    const returned = deliveredEntries.length;
    const hasMore = returned < selected.values.length || selected.hasMore;
    const candidateOffset = offset + returned;
    const nextOffset =
      returned > 0 && hasMore && candidateOffset <= HARD_MAX_OFFSET
        ? candidateOffset
        : null;
    return {
      path: [...path],
      ...(() => {
        const delivered = bounded({
          $type: "map",
          size,
          entries: deliveredEntries,
          returned,
          nextOffset,
        });
        const deliveredReturned = delivered.terminal ? 0 : returned;
        return {
          value: delivered.value!,
          page: page(
            offset,
            limit,
            deliveredReturned,
            size,
            deliveredReturned > 0 ? nextOffset : null,
          ),
        };
      })(),
    };
  }

  if (value instanceof Set) {
    let size: number;
    let iterator: Iterator<unknown>;
    try {
      size = value.size;
      if (offset >= size) {
        const empty: ProbeValue = {
          $type: "set",
          size,
          values: [],
          returned: 0,
          nextOffset: null,
        };
        return {
          path: [...path],
          value: bounded(empty).value!,
          page: page(offset, limit, 0, size, null),
        };
      }
      iterator = value.values();
    } catch (error) {
      return {
        path: [...path],
        value: errorValue(error, maxStringLength),
      };
    }
    const selected = iteratorPage(
      iterator,
      offset,
      addressableLimit,
      maxStringLength,
    );
    if (!selected.ok) return { path: [...path], value: selected.error };
    const values: ProbeValue[] = [];
    for (let index = 0; index < selected.values.length; index++) {
      if (isSerializationExhausted(context)) break;
      values.push(serialize(selected.values[index], [...path, offset + index]));
    }
    const returned = values.length;
    const hasMore = returned < selected.values.length || selected.hasMore;
    const candidateOffset = offset + returned;
    const nextOffset =
      returned > 0 && hasMore && candidateOffset <= HARD_MAX_OFFSET
        ? candidateOffset
        : null;
    return {
      path: [...path],
      ...(() => {
        const delivered = bounded({
          $type: "set",
          size,
          values,
          returned,
          nextOffset,
        });
        const deliveredReturned = delivered.terminal ? 0 : returned;
        return {
          value: delivered.value!,
          page: page(
            offset,
            limit,
            deliveredReturned,
            size,
            deliveredReturned > 0 ? nextOffset : null,
          ),
        };
      })(),
    };
  }

  if (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Date) &&
    !(value instanceof Map) &&
    !(value instanceof Set)
  ) {
    let keys: string[];
    try {
      keys = Object.keys(value);
    } catch (error) {
      return {
        path: [...path],
        value: errorValue(error, maxStringLength),
      };
    }
    if (keys.some((key) => key.length > HARD_MAX_PATH_SEGMENT_LENGTH))
      return {
        path: [...path],
        value: bounded({
          $type: "truncated",
          kind: "object",
          path: [...path],
          total: keys.length,
          returned: 0,
          preview: null,
          nextOffset: null,
          reason: "key-length",
        }).value!,
      };
    const selectedKeys = keys.slice(offset, offset + addressableLimit);
    const selected: Record<string, ProbeValue> = Object.create(null) as Record<
      string,
      ProbeValue
    >;
    for (const key of selectedKeys) {
      if (isSerializationExhausted(context)) break;
      try {
        selected[key] = serialize(Reflect.get(value, key), [...path, key]);
      } catch (error) {
        selected[key] = errorValue(error, maxStringLength);
      }
    }
    const delivered = bounded(selected);
    const returned = delivered.terminal ? 0 : Object.keys(selected).length;
    return {
      path: [...path],
      value: delivered.value!,
      page: page(offset, limit, returned, keys.length, returned > 0 ? undefined : null),
    };
  }

  return { path: [...path], value: bounded(serialize(value, path)).value! };
}
