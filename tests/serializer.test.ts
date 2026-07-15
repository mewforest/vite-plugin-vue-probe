import { describe, expect, it } from 'vitest'
import { AgentOptionsError, serializeAgentValue } from '../src/core/serializer'

describe('serializeAgentValue', () => {
  it('keeps JSON primitives and represents non-JSON primitives explicitly', () => {
    expect(serializeAgentValue(undefined)).toEqual({ $type: 'undefined' })
    expect(serializeAgentValue(Number.NaN)).toEqual({ $type: 'number', value: 'NaN' })
    expect(serializeAgentValue(Number.POSITIVE_INFINITY)).toEqual({ $type: 'number', value: 'Infinity' })
    expect(serializeAgentValue(42n)).toEqual({ $type: 'bigint', value: '42' })
    expect(serializeAgentValue(new Date('2026-07-15T10:00:00.000Z'))).toEqual({
      $type: 'date',
      value: '2026-07-15T10:00:00.000Z',
    })
  })

  it('truncates arrays using an addressable path and entry budget', () => {
    expect(serializeAgentValue([1, 2, 3], {
      maxEntries: 2,
      path: ['setup', 'rows'],
    })).toEqual({
      $type: 'truncated',
      kind: 'array',
      path: ['setup', 'rows'],
      total: 3,
      returned: 2,
      preview: [1, 2],
      nextOffset: 2,
    })
  })

  it('truncates long strings and objects without losing retrieval metadata', () => {
    expect(serializeAgentValue('abcdef', { maxStringLength: 3, path: ['data', 'text'] })).toEqual({
      $type: 'truncated',
      kind: 'string',
      path: ['data', 'text'],
      total: 6,
      returned: 3,
      preview: 'abc',
      nextOffset: 3,
    })

    expect(serializeAgentValue({ a: 1, b: 2 }, { maxEntries: 1, path: ['setup', 'record'] })).toEqual({
      $type: 'truncated',
      kind: 'object',
      path: ['setup', 'record'],
      total: 2,
      returned: 1,
      preview: { a: 1 },
      nextOffset: 1,
    })
  })

  it('represents cycles, Map, Set, and Error as JSON-safe values', () => {
    const cyclic: Record<string, unknown> = { name: 'root' }
    cyclic.self = cyclic

    expect(serializeAgentValue(cyclic)).toEqual({
      name: 'root',
      self: { $type: 'circular-reference', targetPath: [] },
    })
    expect(serializeAgentValue(new Map([['a', 1]]))).toEqual({
      $type: 'map',
      size: 1,
      entries: [['a', 1]],
    })
    expect(serializeAgentValue(new Set([1, 2]))).toEqual({
      $type: 'set',
      size: 2,
      values: [1, 2],
    })
    expect(serializeAgentValue(new TypeError('broken'))).toEqual({
      $type: 'error',
      name: 'TypeError',
      message: 'broken',
    })
    expect(() => JSON.stringify(serializeAgentValue(cyclic))).not.toThrow()
  })

  it('stops descending at maxDepth', () => {
    expect(serializeAgentValue({ nested: { value: 1 } }, { maxDepth: 1 })).toEqual({
      nested: {
        $type: 'truncated',
        kind: 'object',
        path: ['nested'],
        total: 1,
        returned: 0,
        preview: {},
        nextOffset: 0,
      },
    })
  })

  it('rejects invalid budgets and the hard entry limit', () => {
    expect(() => serializeAgentValue([], { maxEntries: 201 })).toThrowError(AgentOptionsError)
    expect(() => serializeAgentValue([], { maxEntries: -1 })).toThrowError(AgentOptionsError)
    expect(() => serializeAgentValue([], { maxDepth: Number.NaN })).toThrowError(AgentOptionsError)
    expect(() => serializeAgentValue('', { maxStringLength: 0 })).toThrowError(AgentOptionsError)
  })

  it('turns throwing array accessors into error values', () => {
    const array: unknown[] = []
    Object.defineProperty(array, 0, {
      enumerable: true,
      get() {
        throw new TypeError('array getter failed')
      },
    })
    array.length = 1

    expect(serializeAgentValue(array)).toEqual([{
      $type: 'error',
      name: 'TypeError',
      message: 'array getter failed',
    }])
  })

  it('preserves own __proto__ keys as JSON data', () => {
    const value = Object.create(null) as Record<string, unknown>
    value.__proto__ = { safe: true }
    const serialized = serializeAgentValue(value)
    const parsed = JSON.parse(JSON.stringify(serialized)) as Record<string, unknown>
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true)
    expect(parsed.__proto__).toEqual({ safe: true })
  })
})
