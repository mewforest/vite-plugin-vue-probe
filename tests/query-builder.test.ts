import { describe, expect, it, vi } from "vitest";
import { createProbeQueryRoot } from "../src/query/builder";
import type { QueryRuntime } from "../src/query/plan";

function runtimeFixture(): QueryRuntime {
  return {
    run: vi.fn(async (plan) => plan),
    show: vi.fn(async (plan, format) => ({ plan, format })),
  };
}

describe("query builders", () => {
  it("is lazy, frozen, reusable, and not thenable", async () => {
    const runtime = runtimeFixture();
    const root = createProbeQueryRoot(runtime);
    const app = root.app();
    const tree = app.tree();
    const state = app.component("UserList").get("setup.rows");

    expect(runtime.run).not.toHaveBeenCalled();
    expect(runtime.show).not.toHaveBeenCalled();
    expect(Object.isFrozen(root)).toBe(true);
    expect(Object.isFrozen(app)).toBe(true);
    expect(Object.isFrozen(tree)).toBe(true);
    expect("then" in state).toBe(false);

    await tree.run();
    await state.page({ offset: 50, limit: 50 }).show("json");

    expect(runtime.run).toHaveBeenCalledWith({
      kind: "tree",
      app: { kind: "app", selector: { kind: "default" } },
      options: { format: "flat", maxDepth: 5, includeFile: false },
    });
    expect(runtime.show).toHaveBeenCalledWith(
      {
        kind: "detailed-state",
        target: {
          kind: "component",
          app: { kind: "app", selector: { kind: "default" } },
          name: "UserList",
          index: 0,
        },
        path: ["setup", "rows"],
        options: {},
        page: { offset: 50, limit: 50 },
      },
      "json",
    );
  });

  it("builds app selectors and singular/plural component plans", async () => {
    const runtime = runtimeFixture();
    const root = createProbeQueryRoot(runtime);

    await root.app("admin").component("Card").nth(2).run();
    await root.app({ name: "Admin" }).components("Card").run();

    expect(runtime.run).toHaveBeenNthCalledWith(1, {
      kind: "component",
      app: { kind: "app", selector: { kind: "id", id: "admin" } },
      name: "Card",
      index: 2,
    });
    expect(runtime.run).toHaveBeenNthCalledWith(2, {
      kind: "components",
      app: { kind: "app", selector: { kind: "name", name: "Admin" } },
      name: "Card",
    });
  });

  it("builds Pinia and DOM continuation plans", async () => {
    const runtime = runtimeFixture();
    const root = createProbeQueryRoot(runtime);

    await root.app().pinia({ includeKeys: true }).run();
    await root.app().pinia("users").get("list.0").run();
    await root.app().component("Card").dom().run();
    await root.app().fromDOM("#card").get("props.item").run();

    expect(runtime.run).toHaveBeenNthCalledWith(1, {
      kind: "pinia-stores",
      app: { kind: "app", selector: { kind: "default" } },
      options: { includeKeys: true },
    });
    expect(runtime.run).toHaveBeenNthCalledWith(2, {
      kind: "detailed-state",
      target: {
        kind: "pinia-store",
        app: { kind: "app", selector: { kind: "default" } },
        storeId: "users",
      },
      path: ["list", 0],
      options: {},
    });
    expect(runtime.run).toHaveBeenNthCalledWith(3, {
      kind: "component-dom",
      component: {
        kind: "component",
        app: { kind: "app", selector: { kind: "default" } },
        name: "Card",
        index: 0,
      },
      options: {},
    });
    expect(runtime.run).toHaveBeenNthCalledWith(4, {
      kind: "detailed-state",
      target: {
        kind: "component-from-dom",
        app: { kind: "app", selector: { kind: "default" } },
        target: "#card",
        options: {},
      },
      path: ["props", "item"],
      options: {},
    });
  });

  it("rejects invalid selector and paging inputs before execution", () => {
    const root = createProbeQueryRoot(runtimeFixture());
    expect(() => root.app(" ")).toThrow(TypeError);
    expect(() => root.app().component("")).toThrow(TypeError);
    expect(() => root.app().component("Card").nth(-1)).toThrow(TypeError);
    expect(() =>
      root
        .app()
        .component("Card")
        .get("items")
        .page({ offset: 0, limit: 0 }),
    ).toThrow(TypeError);
  });
});
