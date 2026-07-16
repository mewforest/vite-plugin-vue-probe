import { describe, expect, it } from "vitest";
import {
  normalizeComponentState,
  normalizePiniaState,
} from "../src/core/normalizer";

describe("inspector normalizers", () => {
  it("groups component state and replaces Pinia stores with references", () => {
    const result = normalizeComponentState(
      {
        id: "app:1",
        name: "TableView",
        state: [
          {
            type: "props",
            key: "title",
            value: "Rows",
            editable: false,
            meta: { type: "String", required: true },
          },
          { type: "setup", key: "page", value: 2, objectType: "ref" },
          {
            type: "🍍 users",
            key: "users",
            value: { _custom: { type: "store", id: "users", value: {} } },
          },
        ],
      },
      "app",
    );

    expect(result.state.props).toEqual({ title: "Rows" });
    expect(result.state.setup).toEqual({ page: 2 });
    expect(result.state.pinia).toEqual({
      users: { $type: "store-reference", storeId: "users", appId: "app" },
    });
    expect(result.metadata?.props?.title).toEqual({
      readonly: true,
      propType: "String",
      required: true,
    });
  });

  it("normalizes Pinia inspector sections without requiring optional groups", () => {
    expect(
      normalizePiniaState(
        { state: [{ key: "rows", value: [1, 2] }] },
        "app",
        "table",
      ),
    ).toEqual({
      appId: "app",
      storeId: "table",
      state: { rows: [1, 2] },
    });
  });

  it("treats malformed _custom wrappers as ordinary values", () => {
    const nullCustom = { _custom: null };
    const primitiveCustom = { _custom: "invalid" };

    const result = normalizeComponentState(
      {
        id: "app:1",
        name: "Example",
        state: [
          { key: "nullCustom", value: nullCustom },
          { key: "primitiveCustom", value: primitiveCustom },
        ],
      },
      "app",
    );

    expect(result.state.setup).toEqual({ nullCustom, primitiveCustom });
  });

  it("converts a throwing _custom accessor into a local error value", () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "_custom", {
      enumerable: true,
      get() {
        throw new Error("hostile accessor");
      },
    });

    const result = normalizeComponentState(
      {
        id: "app:1",
        name: "Example",
        state: [{ key: "hostile", value: hostile }],
      },
      "app",
    );

    expect(result.state.setup?.hostile).toBeInstanceOf(Error);
    expect((result.state.setup?.hostile as Error).message).toContain(
      "custom value",
    );
  });
});
