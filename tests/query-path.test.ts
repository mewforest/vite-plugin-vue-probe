import { describe, expect, it } from "vitest";
import { normalizeQueryPath } from "../src/query/path";

describe("normalizeQueryPath", () => {
  it.each([
    ["props.item.name", ["props", "item", "name"]],
    ["setup.rows.0.name", ["setup", "rows", 0, "name"]],
    ["rows.01", ["rows", "01"]],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeQueryPath(input)).toEqual(expected);
  });

  it("preserves exact array segments", () => {
    const path = ["state", "key.with.dot", 2] as const;
    expect(normalizeQueryPath([...path])).toEqual(path);
  });

  it.each(["", ".state", "state.", "state..name"])(
    "rejects invalid string path %j",
    (path) => expect(() => normalizeQueryPath(path)).toThrow(TypeError),
  );
});
