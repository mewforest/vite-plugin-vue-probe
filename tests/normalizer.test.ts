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
});
