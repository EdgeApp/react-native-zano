// Smoke-test the Node addon: hello + getVersion.
// Run after `npm run build-native-host`:
//   node -r sucrase/register ./scripts/smoke-node.ts

import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { makeNodeZanoModule } from '../src/node'

async function main(): Promise<void> {
  const documentDirectory = mkdtempSync(join(tmpdir(), 'zano-node-'))
  const module = makeNodeZanoModule({ documentDirectory })

  const hello = await module.callZano('hello', [])
  console.log('hello:', hello)

  const version = await module.callZano('getVersion', [])
  console.log('getVersion:', version)

  const names = module.methodNames
  console.log('methodNames count:', names.length)
  if (!names.includes('hello') || !names.includes('getVersion')) {
    throw new Error('methodNames missing hello/getVersion')
  }

  if (hello !== 'hello') {
    throw new Error(`unexpected hello result: ${hello}`)
  }
  if (version.length === 0) {
    throw new Error('getVersion returned empty string')
  }

  process.exit(0)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
