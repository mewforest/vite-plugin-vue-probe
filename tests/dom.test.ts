// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createDOMLocators } from "../src/core/dom";

afterEach(() => {
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
});
