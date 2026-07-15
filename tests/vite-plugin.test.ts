import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import vueAgent, { RESOLVED_VIRTUAL_CLIENT_ID, VIRTUAL_CLIENT_ID } from '../src/index'

describe('vite-plugin-vue-agent', () => {
  it('is an early serve-only plugin', () => {
    const plugin = vueAgent()
    expect(plugin).toMatchObject({ name: 'vite-plugin-vue-agent', apply: 'serve', enforce: 'pre' })
  })

  it('resolves and loads the virtual development client', () => {
    const plugin = vueAgent()
    const resolveId = plugin.resolveId as (id: string) => unknown
    const load = plugin.load as (id: string) => unknown
    expect(resolveId(VIRTUAL_CLIENT_ID)).toBe(RESOLVED_VIRTUAL_CLIENT_ID)
    expect(load(RESOLVED_VIRTUAL_CLIENT_ID)).toContain('installAgentAPI();')
    expect(resolveId('unrelated')).toBeUndefined()
  })

  it('prepends an inline module import and can be disabled', () => {
    const transform = vueAgent().transformIndexHtml as { handler(): unknown[] }
    expect(transform.handler()).toEqual([{
      tag: 'script',
      attrs: { type: 'module' },
      children: `import '${VIRTUAL_CLIENT_ID}';`,
      injectTo: 'head-prepend',
    }])
    const disabled = vueAgent({ enabled: false })
    const disabledTransform = disabled.transformIndexHtml as { handler(): unknown[] }
    expect(disabledTransform.handler()).toEqual([])
  })

  it('does not inject AGENT_API into a production application bundle', async () => {
    const work = join(process.cwd(), 'work')
    await mkdir(work, { recursive: true })
    const root = await mkdtemp(join(work, 'vue-agent-production-'))
    try {
      await writeFile(join(root, 'index.html'), '<main id="app"></main><script type="module" src="/main.js"></script>')
      await writeFile(join(root, 'main.js'), 'document.querySelector("#app").textContent = "production"')
      await build({ root, logLevel: 'silent', plugins: [vueAgent()] })
      const assets = await readdir(join(root, 'dist', 'assets'))
      const javascript = await Promise.all(
        assets.filter(file => file.endsWith('.js')).map(file => readFile(join(root, 'dist', 'assets', file), 'utf8')),
      )
      expect(javascript.join('\n')).not.toContain('AGENT_API')
      expect(await readFile(join(root, 'dist', 'index.html'), 'utf8')).not.toContain(VIRTUAL_CLIENT_ID)
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
