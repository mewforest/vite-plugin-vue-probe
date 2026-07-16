import type { DOMNodeLocator, DOMRectJSON } from "../public-types.js";

const TEXT_PREVIEW_LENGTH = 120;
const MAX_TEXT_NODES = 256;
const MAX_TEXT_CHARACTERS_SCANNED = 4_096;
const MAX_STRUCTURAL_DEPTH = 12;
const MAX_SERIALIZED_CLASSES = 100;
const MAX_DOM_HINT_LENGTH = 1_000;

function rectJSON(element: Element): DOMRectJSON {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  };
}

function escapeIdentifier(value: string): string {
  const css = value && globalThis.CSS;
  if (css && typeof css.escape === "function") return css.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function escapeAttributeValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\0/g, "�")
    .replace(/[\n\r\f]/g, "\\a ");
}

interface QueryRoot extends Node {
  querySelectorAll(selectors: string): NodeListOf<Element>;
}

function queryRoot(element: Element): QueryRoot | undefined {
  const root = element.getRootNode();
  try {
    return typeof Reflect.get(root, "querySelectorAll") === "function"
      ? (root as QueryRoot)
      : undefined;
  } catch {
    return undefined;
  }
}

function isUniqueMatch(
  root: QueryRoot,
  element: Element,
  selector: string,
): boolean {
  if (selector.length > MAX_DOM_HINT_LENGTH) return false;
  try {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch {
    return false;
  }
}

function uniqueSelector(element: Element): string | null {
  if (!element.isConnected) return null;
  const root = queryRoot(element);
  if (!root) return null;

  const testId = element.getAttribute("data-testid");
  if (testId && testId.length <= MAX_DOM_HINT_LENGTH) {
    const selector = `[data-testid="${escapeAttributeValue(testId)}"]`;
    if (isUniqueMatch(root, element, selector)) return selector;
  }

  const id = element.getAttribute("id");
  if (id && id.length <= MAX_DOM_HINT_LENGTH) {
    const selector = `#${escapeIdentifier(id)}`;
    if (isUniqueMatch(root, element, selector)) return selector;
  }

  const parts: string[] = [];
  let current: Element | null = element;
  for (
    let depth = 0;
    current && depth < MAX_STRUCTURAL_DEPTH;
    depth += 1
  ) {
    let part = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (parent) {
      let sameTagIndex = 0;
      let sameTagCount = 0;
      for (const sibling of parent.children) {
        if (sibling.tagName !== current.tagName) continue;
        sameTagCount += 1;
        if (sibling === current) sameTagIndex = sameTagCount;
      }
      if (sameTagCount > 1) part += `:nth-of-type(${sameTagIndex})`;
    }
    parts.unshift(part);
    const selector = parts.join(" > ");
    if (isUniqueMatch(root, element, selector)) return selector;
    current = parent;
  }
  return null;
}

function shadowHosts(element: Element): Element[] | null {
  const innerToOuter: Element[] = [];
  let root = element.getRootNode();
  while (root) {
    let host: unknown;
    try {
      host = Reflect.get(root, "host");
    } catch {
      return null;
    }
    try {
      if (
        typeof host !== "object" ||
        host === null ||
        Reflect.get(host, "nodeType") !== 1 ||
        typeof Reflect.get(host, "getRootNode") !== "function"
      )
        break;
    } catch {
      return null;
    }
    const elementHost = host as Element;
    try {
      if (Reflect.get(elementHost, "shadowRoot") !== root) return null;
    } catch {
      return null;
    }
    innerToOuter.push(elementHost);
    root = elementHost.getRootNode();
  }
  return innerToOuter.reverse();
}

function replayableSelector(element: Element): {
  selector: string | null;
  shadowHostSelectors?: string[];
} {
  const selector = uniqueSelector(element);
  if (!selector) return { selector: null };
  const hosts = shadowHosts(element);
  if (hosts === null) return { selector: null };
  if (hosts.length === 0) return { selector };
  const shadowHostSelectors: string[] = [];
  for (const host of hosts) {
    const hostSelector = uniqueSelector(host);
    if (!hostSelector) return { selector: null };
    shadowHostSelectors.push(hostSelector);
  }
  return { selector, shadowHostSelectors };
}

function classHints(element: Element): string[] {
  const result: string[] = [];
  const iterator = element.classList.values();
  for (let index = 0; index < MAX_SERIALIZED_CLASSES; index += 1) {
    const item = iterator.next();
    if (item.done) break;
    if (typeof item.value !== "string") continue;
    result.push(item.value.slice(0, MAX_DOM_HINT_LENGTH));
  }
  return result;
}

function textPreview(element: Element): string {
  const showText = element.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = element.ownerDocument.createTreeWalker(element, showText);
  let result = "";
  let pendingSpace = false;
  let visitedNodes = 0;
  let scannedCharacters = 0;
  while (
    result.length < TEXT_PREVIEW_LENGTH &&
    visitedNodes < MAX_TEXT_NODES &&
    scannedCharacters < MAX_TEXT_CHARACTERS_SCANNED
  ) {
    const node = walker.nextNode();
    if (!node) break;
    visitedNodes += 1;
    const data = (node as Text).data;
    for (
      let index = 0;
      index < data.length &&
      result.length < TEXT_PREVIEW_LENGTH &&
      scannedCharacters < MAX_TEXT_CHARACTERS_SCANNED;
      index += 1
    ) {
      const character = data[index]!;
      scannedCharacters += 1;
      if (/\s/.test(character)) {
        if (result.length > 0) pendingSpace = true;
        continue;
      }
      if (pendingSpace && result.length < TEXT_PREVIEW_LENGTH) result += " ";
      pendingSpace = false;
      if (result.length < TEXT_PREVIEW_LENGTH) result += character;
    }
  }
  return result;
}

export function createDOMLocators(elements: Element[]): DOMNodeLocator[] {
  return elements.map((element, index) => {
    const text = textPreview(element);
    const rawId = element.getAttribute("id") ?? undefined;
    const id = rawId?.slice(0, MAX_DOM_HINT_LENGTH);
    const classes = classHints(element);
    const selector = replayableSelector(element);
    return {
      index,
      ...selector,
      tag: element.tagName.toLowerCase(),
      ...(id ? { id } : {}),
      ...(classes.length ? { classes } : {}),
      ...(text ? { text } : {}),
      rect: rectJSON(element),
      connected: element.isConnected,
    };
  });
}
