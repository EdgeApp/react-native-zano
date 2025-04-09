'use strict'

import {
  AddressInfo,
  AsyncCallResponse,
  CloseResponse,
  ConnectivityStatus,
  FeePriority,
  JsonRpc,
  ReturnCode,
  TryPullResultResponse,
  WalletDetails,
  WalletFiles,
  WalletInfoExtended,
  WalletStatus
} from './types'

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

  // -----------------------------------------------------------------------------
  // Raw API
  // -----------------------------------------------------------------------------

  async init(
    rpcAddress: string,
    logLevel: number
  ): Promise<JsonRpc<ReturnCode>> {
    const response = await this.module.callZano('init', [
      rpcAddress,
      this.module.documentDirectory,
      logLevel.toFixed()
    ])
    return JSON.parse(response)
  }

  async initWithIpPort(
    ip: string,
    port: string,
    logLevel: number
  ): Promise<JsonRpc<ReturnCode>> {
    const response = await this.module.callZano('initWithIpPort', [
      ip,
      port,
      this.module.documentDirectory,
      logLevel.toFixed()
    ])
    return JSON.parse(response)
  }

  async reset(): Promise<JsonRpc<ReturnCode>> {
    const response = await this.module.callZano('reset', [])
    return JSON.parse(response)
  }

  async setLogLevel(logLevel: number): Promise<string> {
    return await this.module.callZano('setLogLevel', [logLevel.toFixed()])
  }

  async getVersion(): Promise<string> {
    return await this.module.callZano('getVersion', [])
  }

  async getWalletFiles(): Promise<WalletFiles | {}> {
    const files = await this.module.callZano('getWalletFiles', [])
    return JSON.parse(files)
  }

  async getExportPrivateInfo(targetDir: string): Promise<JsonRpc<ReturnCode>> {
    const response = await this.module.callZano('getExportPrivateInfo', [
      targetDir
    ])
    return JSON.parse(response)
  }

  async deleteWallet(fileName: string): Promise<JsonRpc<ReturnCode>> {
    const response = await this.module.callZano('deleteWallet', [fileName])
    return JSON.parse(response)
  }

  async getAddressInfo(addr: string): Promise<AddressInfo> {
    const response = await this.module.callZano('getAddressInfo', [addr])
    return JSON.parse(response)
  }

  async getAppconfig(encryptionKey: string): Promise<object> {
    const response = await this.module.callZano('getAppconfig', [encryptionKey])
    return JSON.parse(response)
  }

  async setAppconfig(
    confStr: string,
    encryptionKey: string
  ): Promise<JsonRpc<ReturnCode>> {
    const response = await this.module.callZano('setAppconfig', [
      confStr,
      encryptionKey
    ])
    return JSON.parse(response)
  }

  async generateRandomKey(length: number): Promise<string> {
    return await this.module.callZano('generateRandomKey', [length.toFixed()])
  }

  async getLogsBuffer(): Promise<string> {
    return await this.module.callZano('getLogsBuffer', [])
  }

  async truncateLog(): Promise<JsonRpc<ReturnCode>> {
    const response = await this.module.callZano('truncateLog', [])
    return JSON.parse(response)
  }

  async getConnectivityStatus(): Promise<ConnectivityStatus> {
    const response = await this.module.callZano('getConnectivityStatus', [])
    return JSON.parse(response)
  }

  async open(path: string, password: string): Promise<JsonRpc<WalletDetails>> {
    const response = await this.module.callZano('open', [path, password])
    return JSON.parse(response)
  }

  async restore(
    seed: string,
    path: string,
    password: string,
    seedPassword: string
  ): Promise<JsonRpc<WalletDetails>> {
    const response = await this.module.callZano('restore', [
      seed,
      path,
      password,
      seedPassword
    ])
    return JSON.parse(response)
  }

  async generate(
    path: string,
    password: string
  ): Promise<JsonRpc<WalletDetails>> {
    const response = await this.module.callZano('generate', [path, password])
    return JSON.parse(response)
  }

  async getOpenedWallets(): Promise<JsonRpc<WalletDetails[]>> {
    const response = await this.module.callZano('getOpenedWallets', [])
    return JSON.parse(response)
  }

  async getWalletStatus(walletId: number): Promise<WalletStatus> {
    const response = await this.module.callZano('getWalletStatus', [
      walletId.toFixed()
    ])
    return JSON.parse(response)
  }

  async closeWallet(walletId: number): Promise<CloseResponse> {
    const response = await this.module.callZano('closeWallet', [
      walletId.toFixed()
    ])
    return JSON.parse(response)
  }

  async invoke(walletId: number, params: string): Promise<string> {
    return await this.module.callZano('invoke', [walletId.toFixed(), params])
  }

  async asyncCall(
    methodName: string,
    instanceId: number,
    params: string
  ): Promise<AsyncCallResponse> {
    const response = await this.module.callZano('asyncCall', [
      methodName,
      instanceId.toFixed(),
      params
    ])
    return JSON.parse(response)
  }

  async tryPullResult(arg: number): Promise<TryPullResultResponse> {
    const response = await this.module.callZano('tryPullResult', [
      arg.toFixed()
    ])
    return JSON.parse(response)
  }

  async syncCall(
    methodName: string,
    instanceId: number,
    params: string
  ): Promise<string> {
    return await this.module.callZano('syncCall', [
      methodName,
      instanceId.toFixed(),
      params
    ])
  }

  async isWalletExist(path: string): Promise<boolean> {
    const response = await this.module.callZano('isWalletExist', [
      this.module.documentDirectory + '/wallets/' + path
    ])
    return response === '1'
  }

  async getWalletInfo(walletId: number): Promise<{
    wi: WalletDetails['wi']
    wi_extended: WalletInfoExtended
  }> {
    const response = await this.module.callZano('getWalletInfo', [
      walletId.toFixed()
    ])
    return JSON.parse(response)
  }

  async resetWalletPassword(
    walletId: number,
    password: string
  ): Promise<string> {
    return await this.module.callZano('resetWalletPassword', [
      walletId.toFixed(),
      password
    ])
  }

  // 0 (default), 1 (unimportant), 2 (normal), 3 (elevated), 4 (priority)
  async getCurrentTxFee(priority: FeePriority): Promise<number> {
    const fee = await this.module.callZano('getCurrentTxFee', [
      priority.toFixed()
    ])
    return parseInt(fee)
  }
}
