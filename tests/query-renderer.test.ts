import { afterEach, describe, expect, it, vi } from "vitest";
import { createProbeQueryAPI } from "../src/query";
import type { ProbeQueryOperations } from "../src/query/executor";
import type { QueryPlan } from "../src/query/plan";
import { showQueryResult } from "../src/query/renderer";
import type {
  AppSummary,
  ComponentDOMResult,
  ComponentStateResult,
  ComponentTreeResult,
  DetailedStateResult,
  ProbeFormatters,
} from "../src/public-types";

afterEach(() => {
  vi.restoreAllMocks();
});

const formatters: ProbeFormatters = {
  stateToPaths: vi.fn(() => "paths-state"),
  toMarkdown: vi.fn(() => "markdown-state"),
  domToTable: vi.fn(() => "markdown-table"),
  treeToMermaid: vi.fn(() => "graph TD"),
  toCleanJson: vi.fn((data) => JSON.stringify(data)),
};

const appPlan = { kind: "app", selector: { kind: "default" } } as const;
const appsPlan: QueryPlan = { kind: "apps" };
const treePlan: QueryPlan = {
  kind: "tree",
  app: appPlan,
  options: { format: "flat", maxDepth: 5, includeFile: false },
};
const statePlan: QueryPlan = {
  kind: "component-state",
  component: {
    kind: "component",
    app: appPlan,
    name: "Card",
    index: 0,
  },
  options: {},
};

const apps: AppSummary[] = [
  { id: "app", name: "Demo", vueVersion: "3.5.0", active: true },
];

const tree: ComponentTreeResult = {
  appId: "app",
  rootId: "root",
  format: "flat",
  truncatedByDepth: false,
  nodes: [],
};

const state: ComponentStateResult = {
  appId: "app",
  componentId: "card",
  name: "Card",
  state: { props: { item: "Ada" } },
};

describe("query renderer", () => {
  it("uses type-specific defaults and returns the printed value", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    const dir = vi.spyOn(console, "dir").mockImplementation(() => {});

    const appRows = showQueryResult(appsPlan, apps, undefined, formatters);
    expect(appRows).toEqual([
      { id: "app", name: "Demo", vueVersion: "3.5.0", active: true },
    ]);
    expect(table).toHaveBeenCalledWith(appRows);

    const markdown = showQueryResult(treePlan, tree, undefined, formatters);
    expect(markdown).toBe("markdown-state");
    expect(log).toHaveBeenCalledWith(markdown);

    const raw = showQueryResult(treePlan, tree, "raw", formatters);
    expect(raw).toBe(tree);
    expect(dir).toHaveBeenCalledWith(tree);
  });

  it("supports tree Mermaid and state paths", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(showQueryResult(treePlan, tree, "mermaid", formatters)).toBe(
      "graph TD",
    );
    expect(showQueryResult(statePlan, state, "paths", formatters)).toBe(
      "paths-state",
    );
    expect(log).toHaveBeenNthCalledWith(1, "graph TD");
    expect(log).toHaveBeenNthCalledWith(2, "paths-state");
  });

  it("renders detailed values with compact page metadata", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const plan: QueryPlan = {
      kind: "detailed-state",
      target: {
        kind: "component",
        app: appPlan,
        name: "List",
        index: 0,
      },
      path: ["setup", "rows"],
      options: {},
      page: { offset: 50, limit: 50 },
    };
    const result: DetailedStateResult = {
      target: { kind: "component", appId: "app", componentId: "list" },
      path: ["setup", "rows"],
      value: [{ id: 51 }],
      page: {
        offset: 50,
        limit: 50,
        returned: 1,
        total: 51,
        nextOffset: null,
      },
    };

    expect(showQueryResult(plan, result, "markdown", formatters)).toBe(
      '```json\n[{"id":51}]\n```\n\n_Page: offset 50, limit 50, returned 1, total 51, nextOffset null_',
    );
    expect(log).toHaveBeenCalledOnce();
  });

  it("sends DOM locator rows to console.table", () => {
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    const plan: QueryPlan = {
      kind: "component-dom",
      component: {
        kind: "component",
        app: appPlan,
        name: "Card",
        index: 0,
      },
      options: {},
    };
    const dom: ComponentDOMResult = {
      appId: "app",
      componentId: "card",
      roots: [
        {
          index: 0,
          selector: "#card",
          tag: "article",
          text: "Ada",
          rect: {
            x: 1,
            y: 2,
            width: 3,
            height: 4,
            top: 2,
            right: 4,
            bottom: 6,
            left: 1,
          },
          connected: true,
        },
      ],
    };

    const rows = showQueryResult(plan, dom, "table", formatters);
    expect(rows).toEqual([
      {
        index: 0,
        selector: "#card",
        tag: "article",
        connected: true,
        text: "Ada",
        x: 1,
        y: 2,
        width: 3,
        height: 4,
      },
    ]);
    expect(table).toHaveBeenCalledWith(rows);
  });

  it("rejects unsupported formats before logging", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    const dir = vi.spyOn(console, "dir").mockImplementation(() => {});

    expect(() =>
      showQueryResult(appsPlan, apps, "mermaid", formatters),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_OPTIONS", step: "render" }),
    );
    expect(log).not.toHaveBeenCalled();
    expect(table).not.toHaveBeenCalled();
    expect(dir).not.toHaveBeenCalled();
  });
});

describe("query runtime composition", () => {
  it("executes run silently and show through the renderer", async () => {
    const dir = vi.spyOn(console, "dir").mockImplementation(() => {});
    const operations: ProbeQueryOperations = {
      formatters,
      listApps: vi.fn(async () => ({
        ok: true as const,
        data: apps,
        meta: {
          requestId: "probe-1",
          revision: 1,
          observedAt: "2026-07-18T00:00:00.000Z",
        },
      })),
      getComponentTree: vi.fn(),
      getComponentState: vi.fn(),
      getDetailedState: vi.fn(),
      getPiniaStores: vi.fn(),
      getPiniaState: vi.fn(),
      getComponentDOM: vi.fn(),
      getComponentFromDOM: vi.fn(),
    };
    const query = createProbeQueryAPI(operations);

    await expect(query.apps().run()).resolves.toEqual(apps);
    expect(dir).not.toHaveBeenCalled();
    await expect(query.apps().show("raw")).resolves.toBe(apps);
    expect(dir).toHaveBeenCalledWith(apps);
  });
});
