'use strict'

/**
 * The shape of the native C++ module exposed to React Native.
 *
 * You do not normally need this, but it is accessible as
 * `require('react-native').NativeModules.ZanoModule`.
 *
 * Pass this object to the `CppBridge` constructor to re-assemble the API.
 */
export interface NativeZanoModule {
  readonly callZano: (name: string, jsonArguments: string[]) => Promise<string>

  readonly methodNames: string[]
  readonly documentDirectory: string
}

export class CppBridge {
  private readonly module: NativeZanoModule

  constructor(zanoModule: NativeZanoModule) {
    this.module = zanoModule
  }

  async getVersion(): Promise<string> {
    return await this.module.callZano('getVersion', [])
  }

  async hello(): Promise<string> {
    return await this.module.callZano('hello', [])
  }

  async initWallet(
    address: string,
    cwd: string,
    logLevel: number
  ): Promise<string> {
    return await this.module.callZano('initWallet', [
      address,
      cwd,
      logLevel.toFixed()
    ])
  }
}
