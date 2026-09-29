export * from './index'
import { initSelfHealing, readAutoInitOptions } from './index'
// Only the script bundle auto-starts. ESM and CommonJS imports are inert.
try {
  const options = readAutoInitOptions()
  if (options) initSelfHealing(options)
} catch { /* Unusual host DOM must not break the page. */ }
