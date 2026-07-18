import type {
  ProbeAPI,
  ProbeCapabilities,
  ProbeError,
  ProbeResult,
  AppSummary,
  ComponentStateResult,
  ComponentStateMetadata,
  ComponentStateSection,
  ComponentTreeNode,
  ComponentTreeOptions,
  DetailedStateOptions,
  PiniaStateResult,
  ResponseMeta,
  SerializedStateMap,
  StateReadOptions,
  StateTarget,
} from "../public-types.js";
import type {
  ProbeDataSource,
  RawComponentState,
  RawPiniaState,
  RawStateMap,
} from "../data-source/types.js";
import { DataSourceError } from "../data-source/types.js";
import { createDOMLocators, resolveDOMElement } from "./dom.js";
import { probeFormatters } from "./formatters.js";
import { createProbeQueryAPI } from "../query/index.js";
import {
  ProbePathError,
  normalizeDetailedOptions,
  resolveDetailedValue,
} from "./path.js";
import {
  boundProbePayload,
  createProbePayloadBudget,
  createSerializationContext,
  claimProbePayloadStrings,
  isSerializationExhausted,
  serializeProbeRecord,
  type ProbePayloadBudget,
  type SerializationContext,
} from "./serializer.js";
import {
  DETAIL_DEFAULTS,
  HARD_MAX_DEPTH,
  HARD_MAX_ENTRIES,
  HARD_MAX_NODES,
  HARD_MAX_OFFSET,
  HARD_MAX_PATH_SEGMENT_LENGTH,
  HARD_MAX_PATH_SEGMENTS,
  HARD_MAX_PATH_TOTAL_LENGTH,
  HARD_MAX_IDENTIFIER_LENGTH,
  HARD_MAX_STRING_LENGTH,
  HARD_MAX_TOTAL_STRING_LENGTH,
  ProbeOptionsError,
  SERIALIZATION_DEFAULTS,
} from "./contract.js";
import {
  validateComponentFromDOM,
  validateComponentDOM,
  validateComponentTreeOptions,
  validateDetailedState,
  validatePiniaStoresOptions,
  validateStateRead,
} from "./validation.js";

export const PROBE_API_VERSION = "0.4.0";

const CAPABILITY_DEFAULTS = Object.freeze({
  maxDepth: SERIALIZATION_DEFAULTS.maxDepth,
  maxEntries: SERIALIZATION_DEFAULTS.maxEntries,
  maxStringLength: SERIALIZATION_DEFAULTS.maxStringLength,
  detailMaxDepth: DETAIL_DEFAULTS.maxDepth,
  detailPageSize: DETAIL_DEFAULTS.limit,
  hardMaxEntries: HARD_MAX_ENTRIES,
  hardMaxDepth: HARD_MAX_DEPTH,
  hardMaxStringLength: HARD_MAX_STRING_LENGTH,
  hardMaxTotalStringLength: HARD_MAX_TOTAL_STRING_LENGTH,
  hardMaxNodes: HARD_MAX_NODES,
  hardMaxOffset: HARD_MAX_OFFSET,
  hardMaxPathSegments: HARD_MAX_PATH_SEGMENTS,
  hardMaxPathSegmentLength: HARD_MAX_PATH_SEGMENT_LENGTH,
  hardMaxPathTotalLength: HARD_MAX_PATH_TOTAL_LENGTH,
  hardMaxIdentifierLength: HARD_MAX_IDENTIFIER_LENGTH,
});

const CAPABILITIES: ProbeCapabilities = Object.freeze({
  apiVersion: PROBE_API_VERSION,
  vueDetected: false,
  piniaDetected: false,
  multipleApps: false,
  componentTree: true,
  componentState: true,
  detailedState: true,
  piniaState: false,
  componentDOM: true,
  componentFromDOM: true,
  stateMutation: false,
  eventTimeline: false,
  defaults: CAPABILITY_DEFAULTS,
});

const COMPONENT_STATE_SECTION_ORDER: readonly ComponentStateSection[] = [
  "props",
  "setup",
  "data",
  "computed",
  "attrs",
  "provided",
  "injected",
  "refs",
  "pinia",
];

function serializeMap(
  map: RawStateMap | undefined,
  prefix: string,
  context: SerializationContext,
  payloadBudget: ProbePayloadBudget,
): SerializedStateMap | undefined {
  if (!map) return undefined;
  return boundProbePayload(
    serializeProbeRecord(map, [prefix], context),
    [prefix],
    payloadBudget,
  ).value as SerializedStateMap | undefined;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function isSectionErrorMarker(
  section: Record<string, unknown>,
): boolean {
  return (
    section.$type === "error" &&
    hasExactKeys(section, ["$type", "name", "message"]) &&
    typeof section.name === "string" &&
    typeof section.message === "string"
  );
}

function isSectionTruncationMarker(
  section: Record<string, unknown>,
): boolean {
  return (
    section.$type === "truncated" &&
    hasExactKeys(
      section,
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
    ["array", "object", "string"].includes(section.kind as string) &&
    Array.isArray(section.path) &&
    section.path.every(
      (segment) =>
        typeof segment === "string" ||
        (Number.isInteger(segment) && (segment as number) >= 0),
    ) &&
    Number.isInteger(section.total) &&
    (section.total as number) >= 0 &&
    Number.isInteger(section.returned) &&
    (section.returned as number) >= 0 &&
    (section.returned as number) <= (section.total as number) &&
    (section.nextOffset === null ||
      (Number.isInteger(section.nextOffset) &&
        (section.nextOffset as number) >= 0)) &&
    (section.reason === undefined ||
      section.reason === "node-budget" ||
      section.reason === "string-budget" ||
      section.reason === "key-length")
  );
}

function serializedKeys(section: SerializedStateMap | undefined): string[] {
  if (!section || Array.isArray(section)) return [];
  const record = section as unknown as Record<string, unknown>;
  if (isSectionTruncationMarker(record)) {
    if (
      typeof record.preview !== "object" ||
      record.preview === null ||
      Array.isArray(record.preview)
    )
      return [];
    return Object.keys(record.preview);
  }
  if (isSectionErrorMarker(record)) return [];
  return Object.keys(record);
}

function pruneMetadata(
  metadata: ComponentStateMetadata | undefined,
  state: ComponentStateResult["state"],
  maxStringLength: number,
  payloadBudget: ProbePayloadBudget,
): ComponentStateMetadata | undefined {
  if (!metadata || payloadBudget.terminalEmitted) return undefined;
  const result: ComponentStateMetadata = {};
  let rootClaimed = false;
  let exhausted = false;
  for (const section of COMPONENT_STATE_SECTION_ORDER) {
    const source = metadata[section];
    if (!source) continue;
    const keys = serializedKeys(state[section]);
    const selected: typeof source = Object.create(null) as typeof source;
    let sectionClaimed = false;
    for (const key of keys) {
      if (!Object.hasOwn(source, key)) continue;
      const raw = source[key]!;
      const entry: typeof raw = {};
      try {
        if (
          raw.reactivity === "ref" ||
          raw.reactivity === "reactive" ||
          raw.reactivity === "computed" ||
          raw.reactivity === "plain"
        )
          entry.reactivity = raw.reactivity;
        if (typeof raw.readonly === "boolean") entry.readonly = raw.readonly;
        if (raw.propType !== undefined)
          entry.propType = String(raw.propType).slice(0, maxStringLength);
        if (typeof raw.required === "boolean") entry.required = raw.required;
      } catch {
        // Skip hostile metadata entries rather than escaping the read boundary.
        continue;
      }
      const overhead = (rootClaimed ? 0 : 1) + (sectionClaimed ? 0 : 1);
      const nodes = overhead + 1 + Object.keys(entry).length;
      const strings = [
        ...(rootClaimed ? [] : ["metadata"]),
        ...(sectionClaimed ? [] : [section]),
        key,
        ...Object.keys(entry),
        ...Object.values(entry).filter(
          (value): value is string => typeof value === "string",
        ),
      ];
      if (
        nodes > payloadBudget.remainingNodes ||
        !claimProbePayloadStrings(payloadBudget, strings)
      ) {
        exhausted = true;
        break;
      }
      payloadBudget.remainingNodes -= nodes;
      rootClaimed = true;
      sectionClaimed = true;
      selected[key] = entry;
    }
    if (Object.keys(selected).length > 0) result[section] = selected;
    if (exhausted) break;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function componentResult(
  raw: RawComponentState,
  options: StateReadOptions,
  context: SerializationContext,
): ComponentStateResult {
  const payloadBudget = createProbePayloadBudget();
  const appId = raw.appId.slice(0, HARD_MAX_IDENTIFIER_LENGTH);
  const componentId = raw.componentId.slice(0, HARD_MAX_IDENTIFIER_LENGTH);
  const name = raw.name.slice(0, HARD_MAX_STRING_LENGTH);
  const file = raw.file?.slice(0, HARD_MAX_STRING_LENGTH);
  claimProbePayloadStrings(payloadBudget, [
    "appId",
    appId,
    "componentId",
    componentId,
    "name",
    name,
    "state",
    ...(file ? ["file", file] : []),
  ]);
  const state: ComponentStateResult["state"] = {};
  for (const section of COMPONENT_STATE_SECTION_ORDER) {
    if (payloadBudget.terminalEmitted) break;
    const rawSection = raw.state[section];
    if (!rawSection) continue;
    if (!claimProbePayloadStrings(payloadBudget, [section])) break;
    const serialized = serializeMap(
      rawSection,
      section,
      context,
      payloadBudget,
    );
    if (serialized) state[section] = serialized;
    if (isSerializationExhausted(context)) break;
  }
  const metadata = options.includeMetadata
    ? pruneMetadata(
        raw.metadata,
        state,
        context.options.maxStringLength,
        payloadBudget,
      )
    : undefined;
  return {
    appId,
    componentId,
    name,
    ...(file ? { file } : {}),
    state,
    ...(metadata ? { metadata } : {}),
  };
}

function piniaResult(
  raw: RawPiniaState,
  context: SerializationContext,
): PiniaStateResult {
  const payloadBudget = createProbePayloadBudget();
  const appId = raw.appId.slice(0, HARD_MAX_IDENTIFIER_LENGTH);
  const storeId = raw.storeId.slice(0, HARD_MAX_IDENTIFIER_LENGTH);
  claimProbePayloadStrings(payloadBudget, [
    "appId",
    appId,
    "storeId",
    storeId,
    "state",
  ]);
  const state = serializeMap(raw.state, "state", context, payloadBudget) ?? {};
  const getters =
    !payloadBudget.terminalEmitted &&
    !isSerializationExhausted(context) &&
    claimProbePayloadStrings(payloadBudget, ["getters"])
      ? serializeMap(raw.getters, "getters", context, payloadBudget)
      : undefined;
  const customProperties = serializeMap(
    !payloadBudget.terminalEmitted &&
      !isSerializationExhausted(context) &&
      claimProbePayloadStrings(payloadBudget, ["customProperties"])
      ? raw.customProperties
      : undefined,
    "customProperties",
    context,
    payloadBudget,
  );
  return {
    appId,
    storeId,
    state,
    ...(getters ? { getters } : {}),
    ...(customProperties ? { customProperties } : {}),
  };
}

function pruneTree(
  nodes: ComponentTreeNode[],
  maxDepth: number | null,
  includeFile: boolean,
): { nodes: ComponentTreeNode[]; truncated: boolean } {
  let truncated = false;
  const visit = (
    node: ComponentTreeNode,
    baseDepth: number,
  ): ComponentTreeNode => {
    const relativeDepth = node.depth - baseDepth;
    const over =
      maxDepth !== null &&
      relativeDepth >= maxDepth &&
      Boolean(node.children?.length);
    if (over) truncated = true;
    const children = over
      ? undefined
      : node.children?.map((child) => visit(child, baseDepth));
    const { children: _children, file, ...rest } = node;
    return {
      ...rest,
      depth: relativeDepth,
      ...(includeFile && file ? { file } : {}),
      ...(children?.length ? { children } : {}),
    };
  };
  const baseDepth = nodes[0]?.depth ?? 0;
  return { nodes: nodes.map((node) => visit(node, baseDepth)), truncated };
}

function flatTree(nodes: ComponentTreeNode[]): ComponentTreeNode[] {
  const result: ComponentTreeNode[] = [];
  const visit = (node: ComponentTreeNode) => {
    const { children, ...flat } = node;
    result.push(flat);
    children?.forEach(visit);
  };
  nodes.forEach(visit);
  return result;
}

function safeErrorMessage(error: unknown, fallback: string): string {
  try {
    if (typeof error === "string")
      return error.slice(0, HARD_MAX_STRING_LENGTH);
    if (
      (typeof error === "object" && error !== null) ||
      typeof error === "function"
    ) {
      const candidate = Reflect.get(error, "message");
      if (typeof candidate === "string")
        return candidate.slice(0, HARD_MAX_STRING_LENGTH);
      return fallback;
    }
    if (
      typeof error === "number" ||
      typeof error === "boolean" ||
      typeof error === "bigint"
    )
      return String(error).slice(0, HARD_MAX_STRING_LENGTH);
  } catch {
    // Keep the stable fallback.
  }
  return fallback;
}

function contractError(error: unknown): ProbeError {
  try {
    if (
      error instanceof DataSourceError ||
      error instanceof ProbePathError ||
      error instanceof ProbeOptionsError
    )
      return {
        code: error.code,
        message: safeErrorMessage(error, "Contract error"),
      };
  } catch {
    // Hostile proxies cannot be classified through instanceof safely.
  }
  return {
    code: "INTERNAL_ERROR",
    message: safeErrorMessage(error, "Internal error"),
  };
}

function validationError(error: unknown): ProbeError {
  return {
    code: "INVALID_OPTIONS",
    message: safeErrorMessage(error, "Invalid options"),
  };
}

export function createProbeAPI(source: ProbeDataSource): ProbeAPI {
  let requestSequence = 0;
  const meta = (revision: number): ResponseMeta => {
    let observedAt = "1970-01-01T00:00:00.000Z";
    try {
      observedAt = new Date().toISOString();
    } catch {
      // Preserve an always-serializable metadata fallback.
    }
    return {
      requestId: `probe-${++requestSequence}`,
      revision,
      observedAt,
    };
  };
  const readRevision = (id?: string): number => {
    const revision = source.getRevision(id);
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new DataSourceError(
        "INTERNAL_ERROR",
        `Invalid revision returned for Vue app: ${id ?? "active"}`,
      );
    return revision;
  };
  const captureMetadata = (
    resolveAppId: () => string | undefined,
  ):
    | { ok: true; revision: number }
    | { ok: false; revision: 0; error: unknown } => {
    try {
      return { ok: true, revision: readRevision(resolveAppId()) };
    } catch (error) {
      return { ok: false, revision: 0, error };
    }
  };
  const appId = (requested?: string): string => {
    const id = requested ?? source.getActiveAppId();
    if (!id)
      throw new DataSourceError(
        "NOT_READY",
        "No Vue application has been detected",
      );
    return id;
  };
  const run = async <T>(
    operation: () => Promise<T> | T,
  ): Promise<ProbeResult<T>> => {
    const metadata = captureMetadata(() => source.getActiveAppId());
    let data: T;
    try {
      data = await operation();
    } catch (error) {
      return {
        ok: false,
        error: contractError(error),
        meta: meta(metadata.revision),
      };
    }
    if (!metadata.ok)
      return {
        ok: false,
        error: contractError(metadata.error),
        meta: meta(0),
      };
    return { ok: true, data, meta: meta(metadata.revision) };
  };
  const runForApp = async <T>(
    requestedAppId: string | undefined,
    operation: (id: string) => Promise<T> | T,
  ): Promise<ProbeResult<T>> => {
    let selectedAppId: string | undefined;
    try {
      selectedAppId = appId(requestedAppId);
    } catch (error) {
      return {
        ok: false,
        error: contractError(error),
        meta: meta(0),
      };
    }
    const metadata = captureMetadata(() => selectedAppId);
    let data: T;
    try {
      data = await operation(selectedAppId);
    } catch (error) {
      return {
        ok: false,
        error: contractError(error),
        meta: meta(metadata.revision),
      };
    }
    if (!metadata.ok)
      return {
        ok: false,
        error: contractError(metadata.error),
        meta: meta(0),
      };
    return { ok: true, data, meta: meta(metadata.revision) };
  };
  const runSnapshotForApp = async <T>(
    requestedAppId: string | undefined,
    expectedRevision: number | undefined,
    operation: (
      id: string,
      verifyUnchanged: () => void,
    ) => Promise<T> | T,
  ): Promise<ProbeResult<T>> => {
    let selectedAppId: string | undefined;
    let metadataRevision = 0;
    try {
      selectedAppId = appId(requestedAppId);
      const snapshotAppId = selectedAppId;
      if (!source.hasApp(snapshotAppId))
        throw new DataSourceError(
          "APP_NOT_FOUND",
          `Vue app not found: ${snapshotAppId}`,
        );
      const revision = readRevision(snapshotAppId);
      metadataRevision = revision;
      if (expectedRevision !== undefined && expectedRevision !== revision)
        throw new DataSourceError(
          "STALE_REVISION",
          `Expected revision ${expectedRevision}, observed ${revision}`,
        );
      const verifyUnchanged = (): void => {
        if (!source.hasApp(snapshotAppId))
          throw new DataSourceError(
            "APP_NOT_FOUND",
            `Vue app was removed while reading: ${snapshotAppId}`,
          );
        const observedRevision = readRevision(snapshotAppId);
        metadataRevision = observedRevision;
        if (observedRevision !== revision)
          throw new DataSourceError(
            "STALE_REVISION",
            `State changed while reading revision ${revision}; observed ${observedRevision}`,
          );
      };
      const data = await operation(snapshotAppId, verifyUnchanged);
      return {
        ok: true,
        data,
        meta: meta(revision),
      };
    } catch (error) {
      return {
        ok: false,
        error: contractError(error),
        meta: meta(metadataRevision),
      };
    }
  };
  const validateAndRun = async <V, T>(
    validate: () => V,
    operation: (value: V) => Promise<ProbeResult<T>>,
  ): Promise<ProbeResult<T>> => {
    let value: V;
    try {
      value = validate();
    } catch (error) {
      return {
        ok: false,
        error: validationError(error),
        meta: meta(0),
      };
    }
    return operation(value);
  };

  const core: Omit<ProbeAPI, "query"> = {
    version: PROBE_API_VERSION,
    formatters: probeFormatters,
    getCapabilities: () =>
      run(async () => {
        const apps = source.listApps();
        const id = source.getActiveAppId();
        const pinia = id ? await source.hasPiniaInspector(id) : false;
        return {
          ...CAPABILITIES,
          defaults: Object.freeze({ ...CAPABILITY_DEFAULTS }),
          vueDetected: apps.length > 0,
          piniaDetected: pinia,
          piniaState: pinia,
          multipleApps: apps.length > 1,
        };
      }),
    listApps: () => run<AppSummary[]>(() => source.listApps()),
    getComponentTree: (unsafeOptions: ComponentTreeOptions = {}) =>
      validateAndRun(
        () => validateComponentTreeOptions(unsafeOptions),
        (options) =>
          runForApp(options.appId, async (id) => {
            const raw = await source.getComponentTree(
              id,
              options.filter,
              options.rootId,
            );
            const format = options.format ?? "nested";
            const pruned = pruneTree(
              raw.nodes,
              options.maxDepth ?? null,
              options.includeFile ?? false,
            );
            return {
              appId: id,
              rootId: raw.rootId,
              format,
              nodes: format === "flat" ? flatTree(pruned.nodes) : pruned.nodes,
              truncatedByDepth: pruned.truncated,
            };
          }),
      ),
    getComponentState: (
      unsafeComponentId,
      unsafeOptions: StateReadOptions = {},
    ) =>
      validateAndRun(
        () =>
          validateStateRead(
            unsafeComponentId,
            "componentId",
            unsafeOptions,
          ),
        ({ id: componentId, options }) =>
          runSnapshotForApp(
            options.appId,
            options.expectedRevision,
            async (id, verifyUnchanged) => {
              const context = createSerializationContext(options);
              const raw = await source.getComponentState(id, componentId);
              const result = componentResult(raw, options, context);
              verifyUnchanged();
              return result;
            },
          ),
      ),
    getDetailedState: (
      unsafeTarget: StateTarget,
      unsafePath,
      unsafeOptions: DetailedStateOptions = {},
    ) =>
      validateAndRun(
        () => validateDetailedState(unsafeTarget, unsafePath, unsafeOptions),
        ({ target, path, options }) =>
          runSnapshotForApp(
            target.appId,
            options.expectedRevision,
            async (id, verifyUnchanged) => {
              const normalizedOptions = normalizeDetailedOptions(options);
              const raw =
                target.kind === "component"
                  ? (await source.getComponentState(id, target.componentId)).state
                  : await source.getPiniaState(id, target.storeId);
              const resolvedTarget = { ...target, appId: id };
              const payloadBudget = createProbePayloadBudget();
              claimProbePayloadStrings(payloadBudget, [
                "target",
                "kind",
                target.kind,
                "appId",
                id,
                ...(target.kind === "component"
                  ? ["componentId", target.componentId]
                  : ["storeId", target.storeId]),
                "path",
                ...path.filter(
                  (segment): segment is string => typeof segment === "string",
                ),
                "value",
              ]);
              const result = {
                target: resolvedTarget,
                ...resolveDetailedValue(
                  raw,
                  path,
                  normalizedOptions,
                  payloadBudget,
                ),
              };
              verifyUnchanged();
              return result;
            },
          ),
      ),
    getPiniaStores: (unsafeOptions = {}) =>
      validateAndRun(
        () => validatePiniaStoresOptions(unsafeOptions),
        (options) =>
          runForApp(options.appId, (id) =>
            source.getPiniaStores(id, options.filter, options.includeKeys),
          ),
      ),
    getPiniaState: (unsafeStoreId, unsafeOptions: StateReadOptions = {}) =>
      validateAndRun(
        () => validateStateRead(unsafeStoreId, "storeId", unsafeOptions),
        ({ id: storeId, options }) =>
          runSnapshotForApp(
            options.appId,
            options.expectedRevision,
            async (id, verifyUnchanged) => {
              const context = createSerializationContext(options);
              const raw = await source.getPiniaState(id, storeId);
              const result = piniaResult(raw, context);
              verifyUnchanged();
              return result;
            },
          ),
      ),
    getComponentDOM: (unsafeComponentId, unsafeOptions = {}) =>
      validateAndRun(
        () => validateComponentDOM(unsafeComponentId, unsafeOptions),
        ({ componentId, options }) =>
          runSnapshotForApp(
            options.appId,
            options.expectedRevision,
            (id, verifyUnchanged) => {
              const result = {
                appId: id,
                componentId,
                roots: createDOMLocators(
                  source.getComponentRoots(id, componentId),
                ),
              };
              verifyUnchanged();
              return result;
            },
          ),
      ),
    getComponentFromDOM: (unsafeTarget, unsafeOptions = {}) =>
      validateAndRun(
        () => validateComponentFromDOM(unsafeTarget, unsafeOptions),
        ({ target, options }) =>
          runSnapshotForApp(
            options.appId,
            options.expectedRevision,
            (id, verifyUnchanged) => {
              const identity = source.getComponentFromElement(
                id,
                resolveDOMElement(target),
              );
              const result = { appId: id, ...identity };
              verifyUnchanged();
              return result;
            },
          ),
      ),
  };
  return {
    ...core,
    query: createProbeQueryAPI(core),
  };
}
