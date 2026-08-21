import { mkdirSync } from 'fs'

import type { NativeZanoModule } from './CppBridge'
import { loadNativeAddon } from './load-addon'

/** Directories the Zano SDK expects under documentDirectory. */
const sdkFolders = ['app_config', 'logs', 'wallets']

export interface MakeNodeZanoModuleOpts {
  documentDirectory: string
}

export type NodeZanoModule = NativeZanoModule

/**
 * Node N-API implementation of the native Zano module.
 * Same `callZano` contract as `NativeModules.ZanoModule`.
 */
export function makeNodeZanoModule(
  opts: MakeNodeZanoModuleOpts
): NodeZanoModule {
  const addon = loadNativeAddon()

  mkdirSync(opts.documentDirectory, { recursive: true })
  for (const name of sdkFolders) {
    mkdirSync(`${opts.documentDirectory}/${name}`, { recursive: true })
  }

  const methodNames = addon.methodNames()

  return {
    callZano: async (name: string, jsonArguments: string[]) =>
      await addon.callZano(name, jsonArguments),
    methodNames,
    documentDirectory: opts.documentDirectory
  }
}
