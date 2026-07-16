// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { collectComponentRootElements } from "../src/data-source/devtools";

describe("component root VNode traversal", () => {
  it("extracts real Elements from synthetic Fragment, Suspense, Teleport, and KeepAlive branches", () => {
    const fragmentStart = document.createElement("header");
    const fragmentEnd = document.createElement("footer");
    const suspenseBranch = document.createElement("main");
    const teleported = document.createElement("dialog");
    const keptAlive = document.createElement("section");
    const vnodeGraph = {
      children: [
        // Fragment roots are represented by an array of child VNodes.
        { children: [{ el: fragmentStart }, { el: fragmentEnd }] },
        // Suspense exposes the currently rendered branch structurally.
        { activeBranch: { el: suspenseBranch } },
        // Teleport's rendered children can be outside the component container.
        { children: [{ el: teleported }] },
        // KeepAlive wraps the active component instance/subTree.
        { component: { subTree: { el: keptAlive } } },
      ],
    };

    expect(collectComponentRootElements(vnodeGraph)).toEqual([
      fragmentStart,
      fragmentEnd,
      suspenseBranch,
      teleported,
      keptAlive,
    ]);
  });

  it("handles deep and cyclic VNode graphs iteratively", () => {
    const root = document.createElement("main");
    const first: Record<string, unknown> = {};
    let current = first;
    for (let index = 0; index < 5_000; index += 1) {
      const next: Record<string, unknown> = {};
      current.activeBranch = next;
      current = next;
    }
    current.el = root;
    current.activeBranch = first;

    expect(collectComponentRootElements(first)).toEqual([root]);
  });

  it("rejects more than 10000 traversed VNode objects", () => {
    const first: Record<string, unknown> = {};
    let current = first;
    for (let index = 0; index < 10_000; index += 1) {
      const next: Record<string, unknown> = {};
      current.activeBranch = next;
      current = next;
    }

    expect(() => collectComponentRootElements(first)).toThrowError(
      expect.objectContaining({ code: "INTERNAL_ERROR" }),
    );
  });

  it("rejects more than 200 distinct DOM roots", () => {
    const vnode = {
      children: Array.from({ length: 201 }, () => ({
        el: document.createElement("div"),
      })),
    };

    expect(() => collectComponentRootElements(vnode)).toThrowError(
      expect.objectContaining({ code: "INTERNAL_ERROR" }),
    );
  });

  it("schedules a shared child only once", () => {
    let sharedVisits = 0;
    const shared = Object.defineProperty({}, "children", {
      get() {
        sharedVisits += 1;
        return undefined;
      },
    });
    const children = Array.from({ length: 40_000 }, () => shared);

    expect(collectComponentRootElements({ children })).toEqual([]);
    expect(sharedVisits).toBe(1);
  });

  it("aborts child-edge scanning at 50000 without filling the traversal stack", () => {
    let indexedReads = 0;
    const shared = {};
    const sparse = new Array(100_000);
    const children = new Proxy(sparse, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          indexedReads += 1;
          return shared;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(() => collectComponentRootElements({ children })).toThrowError(
      expect.objectContaining({ code: "INTERNAL_ERROR" }),
    );
    expect(indexedReads).toBe(50_001);
  });
});
