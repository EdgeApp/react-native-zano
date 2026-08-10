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
   * Makes `deleteWallet` leave the file in place while still reporting OK,
   * which is what the native layer does when the delete fails.
   */
  deleteFails?: boolean
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
      if (file.filePassword !== password) return rpcError('WRONG_PASSWORD')

      const walletId = nextId++
      open.set(walletId, { storagePath, password })
      return walletResult(walletId, file)
    },

    restore: ([mnemonic, storagePath, filePassword]) => {
      if (state.files.has(storagePath)) return rpcError('ALREADY_EXISTS')
      const file: FakeWalletFile = { filePassword, mnemonic }
      state.files.set(storagePath, file)

      const walletId = nextId++
      open.set(walletId, { storagePath, password: filePassword })
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
