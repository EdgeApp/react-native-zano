import { existsSync } from 'fs'
import { join } from 'path'

export interface NativeZanoAddon {
  callZano: (method: string, args: string[]) => Promise<string>
  methodNames: () => string[]
}

function candidatePaths(): string[] {
  const here = __dirname
  const platform = `${process.platform}-${process.arch}`
  const out: string[] = []
  let dir = here
  for (let i = 0; i < 6; i++) {
    out.push(join(dir, 'prebuilds', platform, 'zano.node'))
    out.push(join(dir, 'build', 'Release', 'zano.node'))
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return out
}

let cached: NativeZanoAddon | undefined

export function loadNativeAddon(): NativeZanoAddon {
  if (cached != null) return cached

  const errors: string[] = []
  const missing: string[] = []
  for (const candidate of candidatePaths()) {
    try {
      if (!existsSync(candidate)) {
        missing.push(candidate)
        continue
      }
      // Native addon loaded at runtime when the .node binary exists.

      const mod = require(candidate) as NativeZanoAddon
      if (typeof mod.callZano !== 'function') continue
      cached = mod
      return cached
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${candidate}: ${message}`)
    }
  }

  throw new Error(
    'react-native-zano Node addon not found. Run `npm run build-native-host`. ' +
      (errors.length > 0
        ? errors.join('; ')
        : `Looked in: ${missing.join(', ')}`)
  )
}
