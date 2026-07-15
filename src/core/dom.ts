import type { DOMNodeLocator, DOMRectJSON } from '../public-types'

const TEXT_PREVIEW_LENGTH = 120

function rectJSON(element: Element): DOMRectJSON {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  }
}

function escapeIdentifier(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
    return CSS.escape(value)
  return value.replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`)
}

function uniqueSelector(element: Element): string | null {
  if (!element.isConnected || !element.ownerDocument)
    return null
  const document = element.ownerDocument
  const id = element.getAttribute('id')
  if (id) {
    const selector = `#${escapeIdentifier(id)}`
    try {
      if (document.querySelectorAll(selector).length === 1 && document.querySelector(selector) === element)
        return selector
    }
    catch {}
  }

  const parts: string[] = []
  let current: Element | null = element
  while (current && current !== document.documentElement) {
    let part = current.tagName.toLowerCase()
    const parent: Element | null = current.parentElement
    if (parent) {
      const siblings = [...parent.children].filter(sibling => sibling.tagName === current!.tagName)
      if (siblings.length > 1)
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`
    }
    parts.unshift(part)
    const selector = parts.join(' > ')
    try {
      if (document.querySelectorAll(selector).length === 1 && document.querySelector(selector) === element)
        return selector
    }
    catch {}
    current = parent
  }
  return null
}

export function createDOMLocators(elements: Element[]): DOMNodeLocator[] {
  return elements.map((element, index) => {
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_PREVIEW_LENGTH)
    const id = element.getAttribute('id') ?? undefined
    const classes = [...element.classList]
    return {
      index,
      selector: uniqueSelector(element),
      tag: element.tagName.toLowerCase(),
      ...(id ? { id } : {}),
      ...(classes.length ? { classes } : {}),
      ...(text ? { text } : {}),
      rect: rectJSON(element),
      connected: element.isConnected,
    }
  })
}
