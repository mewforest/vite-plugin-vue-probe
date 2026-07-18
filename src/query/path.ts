import type { StatePath } from "../public-types.js";

export type QueryPath = string | StatePath;

const CANONICAL_INDEX = /^(0|[1-9]\d*)$/;

export function normalizeQueryPath(path: QueryPath): StatePath {
  if (Array.isArray(path)) return [...path];
  if (typeof path !== "string" || path.length === 0) {
    throw new TypeError("Query path must be a non-empty string or StatePath");
  }
  const segments = path.split(".");
  if (segments.some((segment) => segment.length === 0)) {
    throw new TypeError(`Query path contains an empty segment: ${path}`);
  }
  return segments.map((segment) =>
    CANONICAL_INDEX.test(segment) ? Number(segment) : segment,
  );
}
