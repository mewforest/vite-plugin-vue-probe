import type {
  ComponentStateMetadata,
  StateEntryMetadata,
  StoreReferenceProbeValue,
} from "../public-types.js";
import type {
  InspectorComponentPayload,
  InspectorPiniaPayload,
  InspectorStateEntry,
  RawComponentState,
  RawPiniaState,
  RawStateMap,
} from "../data-source/types.js";

const SECTION_ALIASES: Record<string, keyof RawComponentState["state"]> = {
  props: "props",
  setup: "setup",
  data: "data",
  computed: "computed",
  attrs: "attrs",
  attributes: "attrs",
  provided: "provided",
  provide: "provided",
  injected: "injected",
  inject: "injected",
  refs: "refs",
  "template refs": "refs",
};

function ownMap(): RawStateMap {
  return Object.create(null) as RawStateMap;
}

interface CustomRecordResult {
  record?: Record<string, unknown>;
  error?: Error;
}

function readCustomRecord(value: unknown): CustomRecordResult {
  if (typeof value !== "object" || value === null) return {};
  try {
    if (!Object.hasOwn(value, "_custom")) return {};
    const custom = Reflect.get(value, "_custom");
    return typeof custom === "object" && custom !== null
      ? { record: custom as Record<string, unknown> }
      : {};
  } catch {
    return { error: new Error("Unable to inspect custom value") };
  }
}

function unwrapCustom(value: unknown): unknown {
  const custom = readCustomRecord(value);
  if (custom.error) return custom.error;
  if (!custom.record) return value;
  try {
    return Object.hasOwn(custom.record, "value")
      ? Reflect.get(custom.record, "value")
      : value;
  } catch {
    return new Error("Unable to inspect custom value");
  }
}

function storeReference(
  value: unknown,
  appId: string,
): StoreReferenceProbeValue | undefined {
  const custom = readCustomRecord(value).record;
  if (!custom) return undefined;
  try {
    if (Reflect.get(custom, "type") !== "store") return undefined;
    const id = Reflect.get(custom, "id");
    const storeId = id ?? Reflect.get(custom, "value");
    return typeof storeId === "string"
      ? { $type: "store-reference", storeId, appId }
      : undefined;
  } catch {
    return undefined;
  }
}

function entryMetadata(
  entry: InspectorStateEntry,
): StateEntryMetadata | undefined {
  const reactivity: StateEntryMetadata["reactivity"] =
    entry.objectType === "other" ? "plain" : entry.objectType;
  const metadata: StateEntryMetadata = {
    ...(reactivity ? { reactivity } : {}),
    ...(typeof entry.editable === "boolean"
      ? { readonly: !entry.editable }
      : {}),
    ...(entry.meta?.type ? { propType: entry.meta.type } : {}),
    ...(typeof entry.meta?.required === "boolean"
      ? { required: entry.meta.required }
      : {}),
  };
  return Object.keys(metadata).length ? metadata : undefined;
}

export function normalizeComponentState(
  payload: InspectorComponentPayload,
  appId: string,
): RawComponentState {
  const state: RawComponentState["state"] = {};
  const metadata: ComponentStateMetadata = {};
  for (const entry of payload.state) {
    const rawType = (entry.type ?? "setup").toLowerCase();
    const pinia = rawType.startsWith("🍍") || rawType === "pinia";
    const section = pinia ? "pinia" : (SECTION_ALIASES[rawType] ?? "setup");
    const target = (state[section] ??= ownMap());
    target[entry.key] = pinia
      ? (storeReference(entry.value, appId) ?? unwrapCustom(entry.value))
      : unwrapCustom(entry.value);
    const meta = entryMetadata(entry);
    if (meta) {
      const sectionMeta = (metadata[section] ??= Object.create(
        null,
      ) as NonNullable<ComponentStateMetadata[typeof section]>);
      sectionMeta[entry.key] = meta;
    }
  }
  return {
    appId,
    componentId: payload.id,
    name: payload.name,
    ...(payload.file ? { file: payload.file } : {}),
    state,
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

function section(entries: InspectorStateEntry[] | undefined): RawStateMap {
  const result = ownMap();
  for (const entry of entries ?? [])
    result[entry.key] = unwrapCustom(entry.value);
  return result;
}

export function normalizePiniaState(
  payload: InspectorPiniaPayload,
  appId: string,
  storeId: string,
): RawPiniaState {
  const state = section(payload.state);
  const getters = section(payload.getters);
  const customProperties = section(
    payload["custom properties"] ?? payload.customProperties,
  );
  return {
    appId,
    storeId,
    state,
    ...(Object.keys(getters).length ? { getters } : {}),
    ...(Object.keys(customProperties).length ? { customProperties } : {}),
  };
}
