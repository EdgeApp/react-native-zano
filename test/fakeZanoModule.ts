import type { NativeZanoModule } from '../src/CppBridge'

export interface FakeWalletFile {
  filePassword: string
  mnemonic: string
}

export interface FakeState {
  /** Every native call, as `name(arg0,arg1,...)`. */
  calls: string[]
  /** Wallet files on disk, keyed by storage path. */
  files: Map<string, FakeWalletFile>
  /** Forces `closeWallet` to report this instead of doing its work. */
  closeResult?: string
  /** Forces `open` to answer with this raw JSON string. */
  openResult?: string
  /**
   * Raw JSON answers for successive `open` calls, consumed in order. An
   * `undefined` entry falls through to the normal behavior, so a test can
   * single out one call in the middle of the migration.
   */
  openResults?: Array<string | undefined>
  /** Forces `resetWalletPassword` to report this raw string. */
  resetResult?: string
  /**
   * Forces `configure` to answer with this raw string, modeling the native
   * failure path that reports a bare return code instead of JSON.
   */
  configureResult?: string
  /**
   * Makes `deleteWallet` leave the file in place while still reporting OK,
   * which is what the native layer does when the delete fails.
   */
  deleteFails?: boolean
  /**
   * Filled in by the fake: wallet ids whose refresh worker was started via
   * `run_wallet`, so tests can assert which wallets actually sync.
   */
  runningWallets?: Set<number>
  /**
   * Filled in by the fake: storage paths of wallets currently open, keyed by
   * wallet id. Clearing it models a fresh process, since the native library
   * loses its open-wallet table when the app dies.
   */
  openWallets?: Map<number, string>
  /**
   * Filled in by the fake: the `params` object of every `transfer` request
   * that reached the wallet RPC, so tests can assert what would have gone
   * out on the wire.
   */
  transferRequests?: any[]
}

export const FAKE_ADDRESS = 'ZxFakeAddress'
export const FAKE_SEED = 'fake seed words'

const ok = (result: object): string =>
  JSON.stringify({ id: 0, jsonrpc: '2.0', result })

const rpcError = (code: string): string =>
  JSON.stringify({ id: 0, jsonrpc: '2.0', error: { code, message: '' } })

const walletResult = (
  walletId: number,
  file: FakeWalletFile,
  recovered: boolean = false
): string =>
  ok({
    recovered,
    seed: file.mnemonic,
    wallet_id: walletId,
    wi: { address: FAKE_ADDRESS }
  })

/**
 * Implements the native module at the `callZano` string-protocol level, so
 * tests exercise the real `CppBridge` methods end to end.
 *
 * Mirrors the semantics that shape the migration code: `resetWalletPassword`
 * only changes the password of the *open* wallet, and closing the wallet is
 * what writes that password to the file.
 */
export function makeFakeZanoModule(state: FakeState): NativeZanoModule {
  // Wallets currently open, keyed by wallet id:
  const open = new Map<number, { storagePath: string; password: string }>()
  let nextId = 1

  // Wallet ids whose refresh worker has been started with `run_wallet`.
  // Mirrors the native `postponed_run_wallet` mode the bridge configures:
  // opening no longer runs the wallet, so a wallet that should sync must
  // appear here.
  const running = new Set<number>()
  state.runningWallets = running

  // Exposed so a test can model a new process (native loses this table when
  // the app dies) and assert which paths are still held open.
  const openPaths = new Map<number, string>()
  state.openWallets = openPaths

  const transferRequests: any[] = []
  state.transferRequests = transferRequests

  // Results for the async job protocol: `asyncCall` runs the work up front
  // and parks the payload here; `tryPullResult` delivers it on first pull.
  const jobResults = new Map<number, object>()
  let nextJobId = 1

  const methods: {
    [name: string]: (args: string[]) => string
  } = {
    init: () => ok({ return_code: 'OK' }),

    getWalletFiles: () => JSON.stringify({ items: [...state.files.keys()] }),

    open: ([storagePath, password]) => {
      const queued =
        state.openResults != null && state.openResults.length > 0
          ? state.openResults.shift()
          : state.openResult
      if (queued != null) return queued
      const file = state.files.get(storagePath)
      if (file == null) return rpcError('FILE_NOT_FOUND')
      // Native refuses a second open of a file this process already holds.
      // Driven off the exposed table so a test can clear it to model the
      // process dying, which is what a new launch really is.
      for (const path of openPaths.values()) {
        if (path === storagePath) return rpcError('ALREADY_EXISTS')
      }
      if (file.filePassword !== password) return rpcError('WRONG_PASSWORD')

      const walletId = nextId++
      open.set(walletId, { storagePath, password })
      openPaths.set(walletId, storagePath)
      return walletResult(walletId, file)
    },

    restore: ([mnemonic, storagePath, filePassword]) => {
      if (state.files.has(storagePath)) return rpcError('ALREADY_EXISTS')
      const file: FakeWalletFile = { filePassword, mnemonic }
      state.files.set(storagePath, file)

      const walletId = nextId++
      open.set(walletId, { storagePath, password: filePassword })
      openPaths.set(walletId, storagePath)
      return walletResult(walletId, file)
    },

    generate: ([storagePath, password]) => {
      if (state.files.has(storagePath)) return rpcError('ALREADY_EXISTS')
      const file: FakeWalletFile = {
        filePassword: password,
        mnemonic: FAKE_SEED
      }
      state.files.set(storagePath, file)

      const walletId = nextId++
      open.set(walletId, { storagePath, password })
      openPaths.set(walletId, storagePath)
      return walletResult(walletId, file)
    },

    resetWalletPassword: ([walletIdText, password]) => {
      if (state.resetResult != null) return state.resetResult
      const entry = open.get(Number(walletIdText))
      if (entry == null) return 'WALLET_WRONG_ID'
      // In-memory only; the file keeps its password until the close:
      entry.password = password
      return 'OK'
    },

    closeWallet: ([walletIdText]) => {
      if (state.closeResult != null) {
        return JSON.stringify({ response: state.closeResult })
      }
      const entry = open.get(Number(walletIdText))
      if (entry == null) return JSON.stringify({ response: 'WALLET_WRONG_ID' })

      // Closing stores the wallet, writing the in-memory password to disk:
      const file = state.files.get(entry.storagePath)
      if (file != null) file.filePassword = entry.password
      open.delete(Number(walletIdText))
      openPaths.delete(Number(walletIdText))
      running.delete(Number(walletIdText))
      return JSON.stringify({ response: 'OK' })
    },

    deleteWallet: ([storagePath]) => {
      // The real native layer reports OK even when the delete fails:
      if (state.deleteFails !== true) state.files.delete(storagePath)
      return ok({ return_code: 'OK' })
    },

    isWalletExist: ([fullPath]) => {
      // The bridge prefixes the documents directory and `wallets/`:
      const storagePath = fullPath.replace(/^.*\/wallets\//, '')
      return state.files.has(storagePath) ? '1' : '0'
    },

    asyncCall: ([methodName, , params]) => {
      if (methodName !== 'invoke') {
        throw new Error(`No fake for asyncCall method ${methodName}`)
      }
      const request = JSON.parse(params)
      if (request.method !== 'transfer') {
        throw new Error(`No fake for invoke method ${String(request.method)}`)
      }
      transferRequests.push(request.params)

      const jobId = nextJobId++
      jobResults.set(
        jobId,
        JSON.parse(ok({ tx_hash: 'FAKE_TX_HASH', tx_size: 1 }))
      )
      return JSON.stringify({ job_id: jobId })
    },

    tryPullResult: ([jobIdText]) => {
      const result = jobResults.get(Number(jobIdText))
      if (result == null) return JSON.stringify({ status: 'canceled' })
      return JSON.stringify({ status: 'delivered', result })
    },

    syncCall: ([methodName, instanceIdText]) => {
      if (methodName === 'configure') {
        if (state.configureResult != null) return state.configureResult
        // The bridge only ever posts `postponed_run_wallet: true`, which this
        // fake's `open`/`restore`/`generate` already model (nothing runs
        // until `run_wallet`).
        return JSON.stringify({ status: 'OK' })
      }
      if (methodName === 'run_wallet') {
        const walletId = Number(instanceIdText)
        if (!open.has(walletId)) {
          return JSON.stringify({ error_code: 'WALLET_WRONG_ID' })
        }
        running.add(walletId)
        return JSON.stringify({ error_code: 'OK' })
      }
      throw new Error(`No fake for syncCall method ${methodName}`)
    }
  }

  return {
    documentDirectory: '/fake/documents',
    methodNames: Object.keys(methods),

    callZano: async (name, jsonArguments) => {
      state.calls.push(`${name}(${jsonArguments.join(',')})`)
      const method = methods[name]
      if (method == null) throw new Error(`No fake for native method ${name}`)
      return method(jsonArguments)
    }
  }
}
