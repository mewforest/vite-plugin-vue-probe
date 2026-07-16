import type { ProbeErrorCode, SerializationBudget } from "../public-types.js";

export const SERIALIZATION_DEFAULTS = Object.freeze({
  maxDepth: 2,
  maxEntries: 25,
  maxStringLength: 500,
});

export const DETAIL_DEFAULTS = Object.freeze({
  maxDepth: 3,
  limit: 50,
  maxStringLength: 500,
});

export const HARD_MAX_ENTRIES = 200;
export const HARD_MAX_DEPTH = 20;
export const HARD_MAX_STRING_LENGTH = 100_000;
export const HARD_MAX_TOTAL_STRING_LENGTH = 1_000_000;
export const HARD_MAX_NODES = 5_000;
export const HARD_MAX_OFFSET = 1_000_000;
export const HARD_MAX_PATH_SEGMENTS = 100;
export const HARD_MAX_PATH_SEGMENT_LENGTH = 100_000;
export const HARD_MAX_PATH_TOTAL_LENGTH = 100_000;
export const HARD_MAX_IDENTIFIER_LENGTH = 1_000;

export interface NormalizedSerializationOptions {
  maxDepth: number;
  maxEntries: number;
  maxStringLength: number;
}

export class ProbeContractError extends Error {
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

export function integerOption(
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

export function normalizeSerializationOptions(
  options: SerializationBudget = {},
): NormalizedSerializationOptions {
  return {
    maxDepth: integerOption(
      options.maxDepth ?? SERIALIZATION_DEFAULTS.maxDepth,
      "maxDepth",
      0,
      HARD_MAX_DEPTH,
    ),
    maxEntries: integerOption(
      options.maxEntries ?? SERIALIZATION_DEFAULTS.maxEntries,
      "maxEntries",
      1,
      HARD_MAX_ENTRIES,
    ),
    maxStringLength: integerOption(
      options.maxStringLength ?? SERIALIZATION_DEFAULTS.maxStringLength,
      "maxStringLength",
      1,
      HARD_MAX_STRING_LENGTH,
    ),
  };
}
