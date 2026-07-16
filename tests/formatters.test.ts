import { describe, expect, it } from "vitest";
import { probeFormatters } from "../src/core/formatters";
import type {
  ComponentDOMResult,
  ComponentStateResult,
  ComponentTreeResult,
} from "../src/public-types";

const state: ComponentStateResult["state"] = {
  setup: {
    rows: {
      $type: "truncated",
      kind: "array",
      path: ["setup", "rows"],
      total: 240,
      returned: 2,
      preview: [{ id: 1 }, { id: 2 }],
      nextOffset: 2,
    },
    "user.name": "Ada",
    ready: true,
    nested: { count: 3 },
  },
};

const nestedTree: ComponentTreeResult = {
  appId: "app",
  rootId: "root",
  format: "nested",
  truncatedByDepth: false,
  nodes: [
    {
      id: "root",
      name: "App",
      parentId: null,
      depth: 0,
      hasChildren: true,
      children: [
        {
          id: "child",
          name: 'User "Card"',
          parentId: "root",
          depth: 1,
          hasChildren: false,
        },
      ],
    },
  ],
};

describe("probeFormatters", () => {
  it("flattens state into addressable paths and compact summaries", () => {
    expect(probeFormatters.stateToPaths(state)).toBe(
      [
        "setup.rows = [Array 240] (Truncated; returned 2; nextOffset 2)",
        'setup["user.name"] = "Ada"',
        "setup.ready = true",
        "setup.nested.count = 3",
      ].join("\n"),
    );
  });

  it("renders state and component trees as compact Markdown", () => {
    expect(probeFormatters.toMarkdown(state)).toBe(
      [
        "- setup:",
        "  - rows: [Array 240] (Truncated)",
        '  - user.name: "Ada"',
        "  - ready: true",
        "  - nested:",
        "    - count: 3",
      ].join("\n"),
    );
    expect(probeFormatters.toMarkdown(nestedTree)).toBe(
      ["- App (root)", '  - User "Card" (child)'].join("\n"),
    );
  });

  it("renders DOM locators as an escaped Markdown table", () => {
    const roots: ComponentDOMResult["roots"] = [
      {
        index: 0,
        selector: "#save",
        tag: "button",
        text: "Save | continue\nnow",
        rect: {
          x: 10.25,
          y: 20,
          width: 100.5,
          height: 40,
          top: 20,
          right: 110.75,
          bottom: 60,
          left: 10.25,
        },
        connected: true,
      },
      {
        index: 1,
        selector: null,
        tag: "div",
        rect: {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        },
        connected: false,
      },
    ];

    expect(probeFormatters.domToTable(roots)).toBe(
      [
        "| Selector | Tag | Rect (x,y,w,h) | Text Preview |",
        "| --- | --- | --- | --- |",
        "| `#save` | `button` | 10.25,20,100.5,40 | Save \\| continue now |",
        "| *(unavailable)* | `div` | 0,0,0,0 |  |",
      ].join("\n"),
    );
  });

  it("renders nested or flat component relations as deterministic Mermaid", () => {
    expect(probeFormatters.treeToMermaid(nestedTree)).toBe(
      [
        "graph TD",
        '  n0["App"]',
        '  n1["User &quot;Card&quot;"]',
        "  n0 --> n1",
      ].join("\n"),
    );

    const flatTree: ComponentTreeResult = {
      ...nestedTree,
      format: "flat",
      nodes: [nestedTree.nodes[0]!, nestedTree.nodes[0]!.children![0]!].map(
        ({ children: _children, ...node }) => node,
      ),
    };
    expect(probeFormatters.treeToMermaid(flatTree)).toBe(
      probeFormatters.treeToMermaid(nestedTree),
    );
  });

  it("cleans recognized converter markers without deleting user $type fields", () => {
    const value = {
      rows: (state.setup as Record<string, unknown>).rows,
      created: { $type: "date", value: "2026-07-16T00:00:00.000Z" },
      missing: { $type: "undefined" },
      user: { $type: "domain-event", value: 7 },
      knownTypeCollision: {
        $type: "date",
        value: "not-a-converter-date",
        label: "user data",
      },
    };

    expect(JSON.parse(probeFormatters.toCleanJson(value))).toEqual({
      rows: [{ id: 1 }, { id: 2 }],
      created: "2026-07-16T00:00:00.000Z",
      missing: null,
      user: { $type: "domain-event", value: 7 },
      knownTypeCollision: {
        $type: "date",
        value: "not-a-converter-date",
        label: "user data",
      },
    });
  });

  it("exposes an immutable namespace", () => {
    expect(Object.isFrozen(probeFormatters)).toBe(true);
  });

  it("always returns a JSON string for unknown input", () => {
    expect(probeFormatters.toCleanJson(undefined)).toBe("null");
  });
});
