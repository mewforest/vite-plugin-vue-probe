import type {
  ComponentDOMOptions,
  ComponentTreeOptions,
  DetailedStateOptions,
  PiniaStoresOptions,
  StatePath,
  StateReadOptions,
  StateTarget,
} from "../public-types.js";
import {
  HARD_MAX_DEPTH,
  HARD_MAX_IDENTIFIER_LENGTH,
  ProbeOptionsError,
} from "./contract.js";
import { normalizeDetailedOptions, normalizeStatePath } from "./path.js";
import { createSerializationContext } from "./serializer.js";

type SafeRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new ProbeOptionsError(message);
}

function copyPlainRecord(
  value: unknown,
  name: string,
  allowedKeys: readonly string[],
  allowUndefined = true,
): SafeRecord {
  if (value === undefined && allowUndefined)
    return Object.create(null) as SafeRecord;
  let isObject = false;
  let isArray = false;
  let prototype: object | null | undefined;
  let descriptors: PropertyDescriptorMap | undefined;
  try {
    isObject = typeof value === "object" && value !== null;
    if (isObject) {
      isArray = Array.isArray(value);
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    }
  } catch {
    return invalid(`${name} could not be read safely`);
  }
  if (
    !isObject ||
    isArray ||
    (prototype !== Object.prototype && prototype !== null) ||
    !descriptors
  )
    return invalid(`${name} must be a plain object`);

  const keys = Reflect.ownKeys(descriptors);
  const allowed = new Set(allowedKeys);
  const copy = Object.create(null) as SafeRecord;
  for (const key of keys) {
    if (typeof key !== "string" || !allowed.has(key))
      return invalid(`${name} contains an unknown option`);
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor))
      return invalid(`${name}.${key} must be a data property`);
    copy[key] = descriptor.value;
  }
  return copy;
}

function isProbeOptionsError(error: unknown): error is ProbeOptionsError {
  try {
    return error instanceof ProbeOptionsError;
  } catch {
    return false;
  }
}

function requiredId(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    return invalid(`${name} must be a non-empty string`);
  if (value.length > HARD_MAX_IDENTIFIER_LENGTH)
    return invalid(
      `${name} must contain at most ${HARD_MAX_IDENTIFIER_LENGTH} characters`,
    );
  return value;
}

function optionalId(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : requiredId(value, name);
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return invalid(`${name} must be a string`);
  return value;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") return invalid(`${name} must be a boolean`);
  return value;
}

function optionalRevision(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    return invalid("expectedRevision must be a non-negative safe integer");
  return value as number;
}

function validateSerializationRecord(record: SafeRecord): void {
  createSerializationContext(record);
}

export function validateComponentTreeOptions(
  value: unknown,
): ComponentTreeOptions {
  const record = copyPlainRecord(value, "options", [
    "appId",
    "rootId",
    "filter",
    "format",
    "maxDepth",
    "includeFile",
  ]);
  optionalId(record.appId, "appId");
  optionalId(record.rootId, "rootId");
  optionalString(record.filter, "filter");
  optionalBoolean(record.includeFile, "includeFile");
  if (
    record.format !== undefined &&
    record.format !== "nested" &&
    record.format !== "flat"
  )
    invalid('format must be "nested" or "flat"');
  if (
    record.maxDepth !== undefined &&
    record.maxDepth !== null &&
    (!Number.isSafeInteger(record.maxDepth) ||
      (record.maxDepth as number) < 0 ||
      (record.maxDepth as number) > HARD_MAX_DEPTH)
  )
    invalid(
      `maxDepth must be null or an integer between 0 and ${HARD_MAX_DEPTH}`,
    );
  return record as unknown as ComponentTreeOptions;
}

export function validateStateRead(
  id: unknown,
  idName: "componentId" | "storeId",
  value: unknown,
): { id: string; options: StateReadOptions } {
  const record = copyPlainRecord(value, "options", [
    "appId",
    "expectedRevision",
    "includeMetadata",
    "maxDepth",
    "maxEntries",
    "maxStringLength",
  ]);
  optionalId(record.appId, "appId");
  optionalRevision(record.expectedRevision);
  optionalBoolean(record.includeMetadata, "includeMetadata");
  validateSerializationRecord(record);
  return {
    id: requiredId(id, idName),
    options: record as unknown as StateReadOptions,
  };
}

export function validateDetailedState(
  targetValue: unknown,
  pathValue: unknown,
  optionsValue: unknown,
): {
  target: StateTarget;
  path: StatePath;
  options: DetailedStateOptions;
} {
  const target = copyPlainRecord(
    targetValue,
    "target",
    ["kind", "componentId", "storeId", "appId"],
    false,
  );
  optionalId(target.appId, "target.appId");
  if (target.kind === "component") {
    requiredId(target.componentId, "target.componentId");
    if (target.storeId !== undefined)
      invalid("component targets cannot contain storeId");
  } else if (target.kind === "pinia") {
    requiredId(target.storeId, "target.storeId");
    if (target.componentId !== undefined)
      invalid("Pinia targets cannot contain componentId");
  } else {
    invalid('target.kind must be "component" or "pinia"');
  }

  let path: StatePath;
  try {
    path = normalizeStatePath(pathValue as StatePath);
  } catch (error) {
    if (isProbeOptionsError(error)) throw error;
    return invalid("path could not be read safely");
  }

  const options = copyPlainRecord(optionsValue, "options", [
    "offset",
    "limit",
    "expectedRevision",
    "maxDepth",
    "maxEntries",
    "maxStringLength",
  ]);
  optionalRevision(options.expectedRevision);
  normalizeDetailedOptions(options);
  return {
    target: target as unknown as StateTarget,
    path,
    options: options as unknown as DetailedStateOptions,
  };
}

export function validatePiniaStoresOptions(
  value: unknown,
): PiniaStoresOptions {
  const record = copyPlainRecord(value, "options", [
    "appId",
    "filter",
    "includeKeys",
  ]);
  optionalId(record.appId, "appId");
  optionalString(record.filter, "filter");
  optionalBoolean(record.includeKeys, "includeKeys");
  return record as unknown as PiniaStoresOptions;
}

export function validateComponentDOM(
  componentId: unknown,
  value: unknown,
): { componentId: string; options: ComponentDOMOptions } {
  const record = copyPlainRecord(value, "options", [
    "appId",
    "expectedRevision",
  ]);
  optionalId(record.appId, "appId");
  optionalRevision(record.expectedRevision);
  return {
    componentId: requiredId(componentId, "componentId"),
    options: record as unknown as ComponentDOMOptions,
  };
}
