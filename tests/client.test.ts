// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installAgentAPI } from '../src/client'
import type { AgentDataSource } from '../src/data-source/types'

afterEach(() => { delete window.AGENT_API })

describe('installAgentAPI', () => {
  it('installs a frozen, idempotent global API', () => {
    const source = {
      init: vi.fn(), listApps: () => [], getActiveAppId: () => undefined, getRevision: () => 0,
      getComponentTree: vi.fn(), getComponentState: vi.fn(), getPiniaStores: vi.fn(),
      getPiniaState: vi.fn(), getComponentRoots: vi.fn(),
    } as unknown as AgentDataSource
    const first = installAgentAPI(source)
    const second = installAgentAPI(source)
    expect(first).toBe(second)
    expect(first).toBe(window.AGENT_API)
    expect(Object.isFrozen(first)).toBe(true)
    expect(source.init).toHaveBeenCalledOnce()
  })
})
