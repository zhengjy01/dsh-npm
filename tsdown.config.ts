/**
 * Build config for the dsh-npm plugin: node-half lib bundle (dist/index.mjs)
 * plus the browser settings-panel bundle (lib/client.js, closure-factory
 * artifact for the GUI's __ModuleLoader__).
 */
import { clientBundle } from './shared/tsdown.client.ts'

export default clientBundle('dsh-npm', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-llm',
  ],
})
