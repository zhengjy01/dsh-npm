/**
 * dsh-npm — browser half. Registers the NPM settings panel into the web
 * settings page (settings.section entry). The panel configures the
 * registry URL and auth token, and offers quick package lookup/search.
 * Failure policy: registration problems are logged, never thrown — the
 * web shell fails the whole boot when a plugin apply throws, and an
 * external plugin must not take the GUI down.
 */
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section'
// entry) and the client runtime Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { NpmSettingsPanel } from './NpmSettingsPanel.tsx'

/** Required services. */
export const inject = ['slots']

/**
 * Register the NPM settings page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'npm',
      order: 315,
      label: () => 'NPM',
    }, NpmSettingsPanel))
  } catch (error) {
    console.warn('[dsh-npm] settings panel registration failed:', error)
  }
}
