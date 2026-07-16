// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDOMLocators } from "../src/core/dom";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("createDOMLocators", () => {
  it("returns JSON locators for multiple fragment roots", () => {
    document.body.innerHTML =
      '<main><button id="save" class="primary"> Save now </button><button>Cancel</button></main>';
    const roots = [...document.querySelectorAll("button")];
    const locators = createDOMLocators(roots);
    expect(locators).toHaveLength(2);
    expect(locators[0]).toMatchObject({
      selector: "#save",
      tag: "button",
      id: "save",
      classes: ["primary"],
      text: "Save now",
      connected: true,
    });
    expect(locators[1]?.selector).toContain(":nth-of-type(2)");
    expect(() => JSON.stringify(locators)).not.toThrow();
  });

  it("does not invent a selector for detached roots and limits text", () => {
    const element = document.createElement("section");
    element.textContent = "x".repeat(200);
    const locator = createDOMLocators([element])[0]!;
    expect(locator.selector).toBeNull();
    expect(locator.connected).toBe(false);
    expect(locator.text).toHaveLength(120);
  });

  it("prefers a unique data-testid and queries each candidate once", () => {
    document.body.innerHTML =
      '<main><button data-testid="save-action" id="save">Save</button></main>';
    const element = document.querySelector("button")!;
    const queryAll = vi.spyOn(document, "querySelectorAll");
    const queryOne = vi.spyOn(document, "querySelector");

    const locator = createDOMLocators([element])[0]!;

    expect(locator.selector).toBe('[data-testid="save-action"]');
    expect(queryAll).toHaveBeenCalledTimes(1);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("creates selectors relative to a connected ShadowRoot", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML =
      '<section><button data-testid="shadow-save">Save</button></section>';
    const element = shadow.querySelector("button")!;

    const locator = createDOMLocators([element])[0]!;

    expect(locator).toMatchObject({
      selector: '[data-testid="shadow-save"]',
      shadowHostSelectors: ["div"],
      connected: true,
      text: "Save",
    });
  });

  it("provides a replayable outer-to-inner selector chain for nested ShadowRoots", () => {
    const outerHost = document.createElement("section");
    outerHost.dataset.testid = "outer-host";
    document.body.append(outerHost);
    const outerShadow = outerHost.attachShadow({ mode: "open" });
    const innerHost = document.createElement("article");
    innerHost.id = "inner-host";
    outerShadow.append(innerHost);
    const innerShadow = innerHost.attachShadow({ mode: "open" });
    innerShadow.innerHTML = '<button data-testid="action">Save</button>';
    const target = innerShadow.querySelector("button")!;

    const locator = createDOMLocators([target])[0]!;
    let root: Document | ShadowRoot = document;
    for (const hostSelector of locator.shadowHostSelectors ?? []) {
      const host: Element | null = root.querySelector(hostSelector);
      expect(host).not.toBeNull();
      expect(host?.shadowRoot).not.toBeNull();
      root = host!.shadowRoot!;
    }

    expect(locator.shadowHostSelectors).toEqual([
      '[data-testid="outer-host"]',
      "#inner-host",
    ]);
    expect(root.querySelector(locator.selector!)).toBe(target);
  });

  it("does not expose a contextless selector for a closed ShadowRoot", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const closedRoot = host.attachShadow({ mode: "closed" });
    const target = document.createElement("button");
    target.dataset.testid = "closed-action";
    closedRoot.append(target);

    const locator = createDOMLocators([target])[0]!;

    expect(host.shadowRoot).toBeNull();
    expect(locator.selector).toBeNull();
    expect(locator.shadowHostSelectors).toBeUndefined();
  });

  it("caps serialized classes at 100", () => {
    const element = document.createElement("div");
    element.classList.add(
      ...Array.from({ length: 150 }, (_, index) => `class-${index}`),
    );
    document.body.append(element);

    const locator = createDOMLocators([element])[0]!;

    expect(locator.classes).toHaveLength(100);
  });

  it("consumes at most 100 class tokens and bounds attribute hints", () => {
    const element = document.createElement("button");
    const oversized = "x".repeat(1_500);
    element.id = oversized;
    element.dataset.testid = oversized;
    document.body.append(element);
    let iterations = 0;
    Object.defineProperty(element, "classList", {
      configurable: true,
      value: {
        values: () => ({
          next: () => {
            iterations += 1;
            return { done: false, value: oversized };
          },
        }),
      },
    });
    const queryAll = vi.spyOn(document, "querySelectorAll");

    const locator = createDOMLocators([element])[0]!;

    expect(iterations).toBe(100);
    expect(locator.id).toHaveLength(1_000);
    expect(locator.classes).toHaveLength(100);
    expect(locator.classes?.every((value) => value.length === 1_000)).toBe(true);
    expect(
      queryAll.mock.calls.every(([selector]) => selector.length <= 1_000),
    ).toBe(true);
  });

  it("bounds structural selector queries and never reads subtree textContent", () => {
    const appendDeepTarget = (): HTMLSpanElement => {
      let parent: Element = document.body;
      for (let index = 0; index < 30; index += 1) {
        const next = document.createElement("div");
        parent.append(next);
        parent = next;
      }
      const target = document.createElement("span");
      parent.append(target);
      return target;
    };
    const target = appendDeepTarget();
    appendDeepTarget();
    target.append(document.createTextNode("x".repeat(200)));
    const largeSubtree = document.createDocumentFragment();
    for (let index = 0; index < 2_000; index += 1) {
      const child = document.createElement("i");
      child.append(document.createTextNode("unvisited"));
      largeSubtree.append(child);
    }
    target.append(largeSubtree);
    Object.defineProperty(target, "textContent", {
      configurable: true,
      get() {
        throw new Error("full subtree text read");
      },
    });
    const queryAll = vi.spyOn(document, "querySelectorAll");

    const locator = createDOMLocators([target])[0]!;

    expect(locator.text).toHaveLength(120);
    expect(locator.selector).toBeNull();
    expect(queryAll).toHaveBeenCalledTimes(12);
  });
});
