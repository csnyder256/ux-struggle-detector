import { defineConfig } from 'vitest/config'
import path from 'node:path'

const alias = {
  '@': path.resolve(__dirname, './src'),
}

/** next-auth's ESM imports `next/server` without an extension, which Node's own
 *  loader can't resolve (next has no exports map), so let Vite resolve it. */
const server = { deps: { inline: ['next-auth'] } }

/**
 * The four SDK-DOM suites drive the SDK's real 1s dwell timer through Vitest's
 * fake clock. A fake-timer advance delivers a variable number of interval
 * callbacks depending on how busy the machine is, so when those files shared
 * CPU with the other suites, an occasional run delivered fewer ticks and a
 * timing-sensitive assertion failed on a loaded box rather than on the code.
 * They get their own serial project, so the clock stays deterministic; every
 * other suite keeps running in parallel.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          setupFiles: ['./tests/sdk-dom-env.ts'],
          server,
          include: ['tests/**/*.test.ts'],
          exclude: [
            'tests/sdk-dwell-attribution.test.ts',
            'tests/sdk-dwell-backend.test.ts',
            'tests/sdk-dwell-stretch-flow.test.ts',
            'tests/sdk-validity-flow.test.ts',
            'tests/browser-evidence.test.ts',
          ],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'sdk-dom',
          environment: 'node',
          setupFiles: ['./tests/sdk-dom-env.ts'],
          server,
          include: [
            'tests/sdk-dwell-attribution.test.ts',
            'tests/sdk-dwell-backend.test.ts',
            'tests/sdk-dwell-stretch-flow.test.ts',
            'tests/sdk-validity-flow.test.ts',
          ],
          fileParallelism: false,
          // These suites idle for up to a few hundred VIRTUAL seconds, and each
          // 1s tick settles an async emit chain - real wall time on a loaded box
          // can exceed the 5s default even though the work is correct. The
          // timeout is wall-clock headroom, not a model-ceiling: the assertions
          // still depend only on the SDK's observable output.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'browser',
          environment: 'node',
          setupFiles: ['./tests/sdk-dom-env.ts'],
          server,
          include: ['tests/browser-evidence.test.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
})
