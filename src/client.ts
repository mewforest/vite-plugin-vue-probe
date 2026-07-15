import type { AgentAPI } from './public-types'
import type { AgentDataSource } from './data-source/types'
import { DevtoolsDataSource } from './data-source/devtools'
import { createAgentAPI } from './core/facade'

export function installAgentAPI(source: AgentDataSource = new DevtoolsDataSource()): AgentAPI | undefined {
  if (typeof window === 'undefined')
    return undefined
  if (window.AGENT_API)
    return window.AGENT_API
  source.init()
  const api = Object.freeze(createAgentAPI(source))
  Object.defineProperty(window, 'AGENT_API', {
    value: api,
    configurable: true,
    enumerable: false,
    writable: false,
  })
  return api
}

export type * from './public-types'
