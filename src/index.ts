import type { HtmlTagDescriptor, Plugin } from 'vite'

export const VIRTUAL_CLIENT_ID = 'virtual:vite-plugin-vue-agent/client'
export const RESOLVED_VIRTUAL_CLIENT_ID = `\0${VIRTUAL_CLIENT_ID}`

export interface VueAgentPluginOptions {
  /** Disable the development injection without changing the Vite plugins array. */
  enabled?: boolean
}

export default function vueAgent(options: VueAgentPluginOptions = {}): Plugin {
  const enabled = options.enabled ?? true
  return {
    name: 'vite-plugin-vue-agent',
    apply: 'serve',
    enforce: 'pre',
    resolveId(id) {
      if (enabled && id === VIRTUAL_CLIENT_ID)
        return RESOLVED_VIRTUAL_CLIENT_ID
    },
    load(id) {
      if (enabled && id === RESOLVED_VIRTUAL_CLIENT_ID)
        return `import { installAgentAPI } from 'vite-plugin-vue-agent/client';\ninstallAgentAPI();`
    },
    transformIndexHtml: {
      order: 'pre',
      handler(): HtmlTagDescriptor[] {
        if (!enabled)
          return []
        return [{
          tag: 'script',
          attrs: { type: 'module' },
          children: `import '${VIRTUAL_CLIENT_ID}';`,
          injectTo: 'head-prepend',
        }]
      },
    },
  }
}

export type * from './public-types'
