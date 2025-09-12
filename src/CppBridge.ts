'use strict'

import {
  AddressInfo,
  asMaybeBusy,
  AsyncCallResponse,
  BurnAssetParams,
  CloseResponse,
  ConnectivityStatus,
  FeePriority,
  GetBalancesResponse,
  GetRecentTransactionsResponse,
  GetSeedPhraseInfo,
  JsonRpc,
  ReturnCode,
  TransferParams,
  TransferResponse,
  TryPullResultResponse,
  WalletDetails,
  WalletFiles,
  WalletInfoExtended,
  WalletStatus,
  WhitelistAssetsResponse
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

  async tryPullResult<T>(arg: number): Promise<TryPullResultResponse<T>> {
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

  // -----------------------------------------------------------------------------
  // Convenience API
  // -----------------------------------------------------------------------------

  async getSeedPhraseInfo(
    seed: string,
    seedPassword: string
  ): Promise<GetSeedPhraseInfo> {
    const params: any = {
      seed_phrase: seed,
      seed_password: seedPassword
    }
    const seedInfo = await this._asyncCallWithRetry<GetSeedPhraseInfo>(
      'get_seed_phrase_info',
      0,
      JSON.stringify(params)
    )

    return seedInfo
  }

  async generateSeedPhrase(
    rpcAddress: string,
    storagePath: string,
    seedPassword: string,
    logLevel: number = -1
  ): Promise<WalletDetails> {
    await this.init(rpcAddress, logLevel)

    const response = await this.generate(storagePath, seedPassword)

    const result = this.handleRpcResponse(response)
    await this.closeWallet(result.wallet_id)

    return result
  }

  async startWallet(
    mnemonicSeed: string,
    seedPassword: string,
    storagePath: string
  ): Promise<WalletDetails> {
    const files = await this.getWalletFiles()

    let items: string[] = []
    if ('items' in files) {
      items = files.items
    }

    if (!items.includes(storagePath)) {
      const response = await this.restore(
        mnemonicSeed,
        storagePath,
        seedPassword,
        seedPassword
      )

      const result = this.handleRpcResponse(response)
      return result
    } else {
      const response = await this.open(storagePath, seedPassword)

      const result = this.handleRpcResponse(response)
      return result
    }
  }

  async stopWallet(walletId: number): Promise<string> {
    const closeResponse = await this._asyncCallWithRetry<ReturnCode>(
      'close',
      walletId,
      ''
    )
    if (closeResponse.return_code !== 'OK') {
      throw new Error(`${closeResponse.return_code}`)
    }

    return closeResponse.return_code
  }

  async removeWallet(walletId: number): Promise<void> {
    const response = await this.getOpenedWallets()
    const result = this.handleRpcResponse(response)

    const wallet = result.find(w => w.wallet_id === walletId)
    if (wallet == null) return

    await this.stopWallet(walletId)
    await this.deleteWallet(wallet.wi.path)
  }

  async walletStatus(walletId: number): Promise<WalletStatus> {
    const walletStatus = await this._asyncCallWithRetry<WalletStatus>(
      'get_wallet_status',
      walletId,
      ''
    )

    return walletStatus
  }

  async getBalances(walletId: number): Promise<GetBalancesResponse> {
    const params = {
      method: 'getbalance'
    }
    const response = await this._asyncCallWithRetry<
      JsonRpc<GetBalancesResponse>
    >('invoke', walletId, JSON.stringify(params))

    const result = this.handleRpcResponse(response)
    return result
  }

  async getTransactions(
    walletId: number,
    offset: number = 0
  ): Promise<GetRecentTransactionsResponse> {
    const params = {
      method: 'get_recent_txs_and_info2',
      params: {
        count: 100,
        exclude_mining_txs: true,
        exclude_unconfirmed: false,
        offset,
        order: 'FROM_BEGIN_TO_END',
        update_provision_info: true
      }
    }
    const response = await this._asyncCallWithRetry<
      JsonRpc<GetRecentTransactionsResponse>
    >('invoke', walletId, JSON.stringify(params))

    const result = this.handleRpcResponse(response)
    return result
  }

  async whitelistAssets(walletId: number, assetIds: string[]): Promise<void> {
    const currentWhitelistParams = {
      method: 'assets_whitelist_get',
      params: {}
    }
    const whitelistAssetsResponse = await this._asyncCallWithRetry<
      WhitelistAssetsResponse | {}
    >('invoke', walletId, JSON.stringify(currentWhitelistParams))

    let whitelistSet: Set<string> = new Set()
    if ('local_whitelist' in whitelistAssetsResponse) {
      whitelistSet = new Set(
        whitelistAssetsResponse.local_whitelist.map(asset => asset.asset_id)
      )
    }

    for (const assetId of assetIds) {
      if (!whitelistSet.has(assetId)) {
        const addAssetParams = {
          method: 'assets_whitelist_add',
          params: {
            asset_id: assetId
          }
        }
        await this._asyncCallWithRetry(
          'invoke',
          walletId,
          JSON.stringify(addAssetParams)
        )
      }
    }
  }

  async transfer(walletId: number, opts: TransferParams): Promise<string> {
    // Transaction can only have one payment ID
    let paymentId = opts.paymentId
    for (const transfer of opts.transfers) {
      const addressInfo = await this.getAddressInfo(transfer.recipient)
      if (!addressInfo.is_integrated) continue

      if (paymentId == null) {
        paymentId = addressInfo.payment_id
      } else if (paymentId !== addressInfo.payment_id) {
        throw new Error('Transaction can only have one payment ID')
      }
    }

    const params = {
      method: 'transfer',
      params: {
        destinations: opts.transfers.map(t => ({
          address: t.recipient,
          amount: t.nativeAmount,
          asset_id: t.assetId
        })),

        comment: opts.comment,
        fee: opts.fee,
        payment_id: opts.paymentId ?? '',

        hide_receiver: true,
        mixin: 15,
        push_payer: false,
        service_entries_permanent: true
      }
    }
    const response = await this._asyncCallWithRetry<JsonRpc<TransferResponse>>(
      'invoke',
      walletId,
      JSON.stringify(params)
    )

    const result = this.handleRpcResponse(response)
    return result.tx_hash
  }

  async burnAsset(walletId: number, opts: BurnAssetParams): Promise<string> {
    const params = {
      method: 'burn_asset',
      params: {
        asset_id: opts.assetId,
        burn_amount: opts.burnAmount,
        native_amount: opts.nativeAmount ?? 0,
        point_tx_to_address: opts.pointTxToAddress ?? '',
        service_entries: opts.serviceEntries ?? []
      }
    }
    const response = await this._asyncCallWithRetry<JsonRpc<TransferResponse>>(
      'invoke',
      walletId,
      JSON.stringify(params)
    )

    const result = this.handleRpcResponse(response)
    return JSON.stringify(result)
  }

  // -----------------------------------------------------------------------------
  // Utils
  // -----------------------------------------------------------------------------

  private handleRpcResponse<T>(json: JsonRpc<T>): T {
    if ('result' in json) {
      return json.result
    } else if ('error' in json) {
      throw new Error(`${json.error.code} ${json.error.message}`)
    } else {
      throw new Error('Unknown error')
    }
  }

  private async _asyncCallWithRetry<T>(
    methodName: string,
    instanceId: number,
    params: string
  ): Promise<T> {
    while (true) {
      const jobIdResponse = await this.asyncCall(methodName, instanceId, params)

      while (true) {
        const tryPullResponse = await this.tryPullResult<T>(
          jobIdResponse.job_id
        )

        await new Promise(resolve => setTimeout(resolve, 100)) // 100 ms recommended by documentation
        if (tryPullResponse.status === 'idle') {
          // try this again. job ID is still valid
          continue
        } else if (tryPullResponse.status === 'delivered') {
          const error = asMaybeBusy(tryPullResponse.result)
          if (error != null) {
            // try this again. job ID is no longer valid
            break
          }

          return tryPullResponse.result as T
        } else if (tryPullResponse.status === 'canceled') {
          throw new Error(`${methodName} job canceled`)
        }
      }
    }
  }
}
