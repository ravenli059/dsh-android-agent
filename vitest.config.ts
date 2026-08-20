import { defineConfig } from 'vitest/config'

export default defineConfig({
  // npm SDK packages reference sourcemaps that are not published (files
  // exclude *.map); do not attempt to load them during transform.
  server: {
    sourcemapIgnoreList: () => true,
  },
  test: {
    include: ['tests/**/*.{spec,test}.{ts,tsx}'],
    pool: 'forks',
    server: {
      deps: {
        inline: [/@deepseek-ai\//],
      },
    },
  },
})
