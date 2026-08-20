/**
 * Standalone build config for the dsh-android-agent plugin.
 * Uses the self-contained client-bundle preset (build/tsdown.client.ts, a
 * frozen copy of the dsh-web-ui repo's shared/tsdown.client.ts + web-platform.ts):
 * node-half lib/ plus the browser bundle lib/client.js for the GUI.
 */
import { clientBundle } from './build/tsdown.client.ts'

export default clientBundle('dsh-android-agent', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-tools',
  ],
})
