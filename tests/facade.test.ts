import { describe, expect, it } from 'vitest'
import { createAgentAPI } from '../src/core/facade'
import type { AgentDataSource } from '../src/data-source/types'

function sourceFixture(overrides: Partial<AgentDataSource> = {}): AgentDataSource {
  return {
    init() {},
    listApps: () => [{ id: 'app', name: 'Demo', vueVersion: '3.5.0', active: true }],
    getActiveAppId: () => 'app',
    getRevision: () => 4,
    getComponentTree: async () => ({
      appId: 'app',
      rootId: 'app:root',
      nodes: [{
        id: 'app:root', name: 'Root', parentId: null, depth: 0, hasChildren: true, file: '/Root.vue',
        children: [{ id: 'app:1', name: 'Child', parentId: 'app:root', depth: 1, hasChildren: false }],
      }],
    }),
    getComponentState: async () => ({
      appId: 'app', componentId: 'app:1', name: 'Child',
      state: { setup: { rows: Array.from({ length: 1000 }, (_, id) => ({ id })) } },
    }),
    getPiniaStores: async () => [{ appId: 'app', id: 'users', stateKeys: ['users'], getterKeys: ['count'] }],
    getPiniaState: async () => ({ appId: 'app', storeId: 'users', state: { users: [1, 2, 3] }, getters: { count: 3 } }),
    getComponentRoots: () => [],
    ...overrides,
  }
}

describe('Agent API facade', () => {
  it('returns capabilities, app list, and flat depth-limited trees', async () => {
    const api = createAgentAPI(sourceFixture())
    expect(await api.getCapabilities()).toMatchObject({ ok: true, data: { vueDetected: true, piniaDetected: true } })
    expect(await api.listApps()).toMatchObject({ ok: true, data: [{ id: 'app' }] })
    const tree = await api.getComponentTree({ format: 'flat', maxDepth: 0 })
    expect(tree).toMatchObject({ ok: true, data: { format: 'flat', truncatedByDepth: true, nodes: [{ id: 'app:root' }] } })
    expect(JSON.stringify(tree)).not.toContain('/Root.vue')
  })

  it('serializes component and Pinia state and pages detailed paths', async () => {
    const api = createAgentAPI(sourceFixture())
    const state = await api.getComponentState('app:1')
    expect(state).toMatchObject({ ok: true, data: { state: { setup: { rows: { $type: 'truncated', total: 1000 } } } } })
    const detail = await api.getDetailedState({ kind: 'component', componentId: 'app:1' }, ['setup', 'rows'], { offset: 25, limit: 2 })
    expect(detail).toMatchObject({ ok: true, data: { page: { offset: 25, returned: 2, nextOffset: 27 }, value: [{ id: 25 }, { id: 26 }] } })
    expect(await api.getPiniaStores()).toMatchObject({ ok: true, data: [{ id: 'users' }] })
    expect(await api.getPiniaState('users')).toMatchObject({ ok: true, data: { getters: { count: 3 } } })
    expect(() => JSON.stringify([state, detail])).not.toThrow()
  })

  it('returns stale and not-ready failures instead of throwing', async () => {
    const api = createAgentAPI(sourceFixture())
    await expect(api.getComponentState('app:1', { expectedRevision: 3 })).resolves.toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } })
    const unavailable = createAgentAPI(sourceFixture({ listApps: () => [], getActiveAppId: () => undefined }))
    await expect(unavailable.getComponentTree()).resolves.toMatchObject({ ok: false, error: { code: 'NOT_READY' } })
    await expect(api.getComponentState('app:1', { maxEntries: 201 })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_OPTIONS' } })
  })

  it('returns component DOM through the same envelope', async () => {
    const api = createAgentAPI(sourceFixture())
    expect(await api.getComponentDOM('app:1')).toMatchObject({ ok: true, data: { appId: 'app', componentId: 'app:1', roots: [] }, meta: { revision: 4 } })
  })
})
