import { strict as assert } from 'assert'

import { CppBridge } from '../src/CppBridge'
import { ZanoError } from '../src/types'
import { deriveWalletFilePassword } from '../src/walletFilePassword'
import { FakeState, FakeWalletFile, makeFakeZanoModule } from './fakeZanoModule'

const MNEMONIC =
  'like like like like like like like like like like like like like like like like like like like like like like like like shoulder mom'
const STORAGE_PATH = 'AA'
const DERIVED = deriveWalletFilePassword(MNEMONIC)

const makeState = (file?: FakeWalletFile): FakeState => {
  const files = new Map<string, FakeWalletFile>()
  if (file != null) files.set(STORAGE_PATH, file)
  return { calls: [], files }
}

const makeBridge = (state: FakeState): CppBridge =>
  new CppBridge(makeFakeZanoModule(state))

describe('startWallet', () => {
  it('creates a missing file with the derived password, not the seed passphrase', async () => {
    const state = makeState()
    const bridge = makeBridge(state)

    const wallet = await bridge.startWallet(MNEMONIC, 'hunter2', STORAGE_PATH)

    assert.equal(typeof wallet.wallet_id, 'number')
    const file = state.files.get(STORAGE_PATH)
    assert.equal(file?.filePassword, DERIVED)
    // The regression this guards: one value used for the file password and
    // the seed password. The restore call must carry both, distinct:
    assert.ok(
      state.calls.includes(
        `restore(${MNEMONIC},${STORAGE_PATH},${DERIVED},hunter2)`
      ),
      `restore call not found in: ${state.calls.join('\n')}`
    )
    // The restore opens postponed; the returned wallet must be running:
    assert.deepEqual([...(state.runningWallets ?? [])], [wallet.wallet_id])
  })

  it('opens a file already on the derived password without touching it', async () => {
    const state = makeState({ filePassword: DERIVED, mnemonic: MNEMONIC })
    const bridge = makeBridge(state)

    const wallet = await bridge.startWallet(MNEMONIC, '', STORAGE_PATH)

    const joined = state.calls.join('\n')
    assert.ok(!joined.includes('resetWalletPassword'))
    assert.ok(!joined.includes('restore'))
    assert.ok(!joined.includes('deleteWallet'))
    // The postponed-run contract holds on the plain-open path too: dropping
    // `started()` here would otherwise leave the wallet open but not syncing.
    assert.ok(joined.includes('syncCall(configure,'))
    assert.deepEqual([...(state.runningWallets ?? [])], [wallet.wallet_id])
  })

  it('re-keys a file encrypted with the empty string', async () => {
    const state = makeState({ filePassword: '', mnemonic: MNEMONIC })
    const bridge = makeBridge(state)

    const wallet = await bridge.startWallet(MNEMONIC, '', STORAGE_PATH)

    assert.equal(typeof wallet.wallet_id, 'number')
    assert.equal(state.files.get(STORAGE_PATH)?.filePassword, DERIVED)
    // The exact sequence: postpone the refresh worker so no open below can
    // start a scan that would block the re-key, probe with the new password,
    // open legacy, re-key in memory, close to persist, verify by reopening,
    // and only then start the worker:
    assert.deepEqual(state.calls, [
      'syncCall(configure,0,{"postponed_run_wallet":true})',
      'getWalletFiles()',
      `open(${STORAGE_PATH},${DERIVED})`,
      `open(${STORAGE_PATH},)`,
      `resetWalletPassword(1,${DERIVED})`,
      'closeWallet(1)',
      `open(${STORAGE_PATH},${DERIVED})`,
      'syncCall(run_wallet,2,)'
    ])
    assert.deepEqual([...(state.runningWallets ?? [])], [wallet.wallet_id])
  })

  it('re-keys a file encrypted with a real seed passphrase', async () => {
    const state = makeState({ filePassword: 'hunter2', mnemonic: MNEMONIC })
    const bridge = makeBridge(state)

    const wallet = await bridge.startWallet(MNEMONIC, 'hunter2', STORAGE_PATH)

    assert.equal(state.files.get(STORAGE_PATH)?.filePassword, DERIVED)
    assert.deepEqual([...(state.runningWallets ?? [])], [wallet.wallet_id])
  })

  it('is idempotent across launches', async () => {
    const state = makeState({ filePassword: '', mnemonic: MNEMONIC })
    const bridge = makeBridge(state)

    const first = await bridge.startWallet(MNEMONIC, '', STORAGE_PATH)
    state.calls.length = 0
    // A new launch is a new process: native loses its open-wallet table and
    // its running workers, so the second start opens the file fresh rather
    // than re-using a handle.
    state.openWallets?.clear()
    state.runningWallets?.clear()
    const second = await bridge.startWallet(MNEMONIC, '', STORAGE_PATH)

    assert.ok(!state.calls.join('\n').includes('resetWalletPassword'))
    assert.equal(typeof second.wallet_id, 'number')
    assert.notEqual(first.wallet_id, second.wallet_id)
    assert.deepEqual([...(state.runningWallets ?? [])], [second.wallet_id])
  })

  it('configures postponed run once per bridge', async () => {
    const state = makeState({ filePassword: DERIVED, mnemonic: MNEMONIC })
    const bridge = makeBridge(state)

    await bridge.startWallet(MNEMONIC, '', STORAGE_PATH)
    // The same process starts another wallet: the native flag is sticky, so
    // the bridge must not pay a second configure round trip.
    state.openWallets?.clear()
    state.runningWallets?.clear()
    await bridge.startWallet(MNEMONIC, '', STORAGE_PATH)

    const configures = state.calls.filter(call =>
      call.startsWith('syncCall(configure,')
    )
    assert.equal(configures.length, 1, state.calls.join('\n'))
  })

  it('retries configure after a failure, and reports it readably', async () => {
    const state = makeState({ filePassword: DERIVED, mnemonic: MNEMONIC })
    // The native failure path answers with a bare return-code string, not
    // JSON; the bridge must report it, not throw an opaque SyntaxError:
    state.configureResult = 'UNINITIALIZED'
    const bridge = makeBridge(state)

    await assert.rejects(
      bridge.startWallet(MNEMONIC, '', STORAGE_PATH),
      /Zano configure returned UNINITIALIZED/
    )

    // A failure must not latch the short-circuit: the next start retries.
    delete state.configureResult
    const wallet = await bridge.startWallet(MNEMONIC, '', STORAGE_PATH)
    assert.deepEqual([...(state.runningWallets ?? [])], [wallet.wallet_id])
    const configures = state.calls.filter(call =>
      call.startsWith('syncCall(configure,')
    )
    assert.equal(configures.length, 2, state.calls.join('\n'))
  })

  it('refuses a second start while the first is still open', async () => {
    const state = makeState({ filePassword: DERIVED, mnemonic: MNEMONIC })
    const bridge = makeBridge(state)

    const first = await bridge.startWallet(MNEMONIC, '', STORAGE_PATH)
    state.calls.length = 0

    await assert.rejects(
      bridge.startWallet(MNEMONIC, '', STORAGE_PATH),
      /ALREADY_EXISTS/
    )
    assert.ok(!state.calls.join('\n').includes('deleteWallet'))
    assert.deepEqual([...(state.runningWallets ?? [])], [first.wallet_id])
  })

  it('rebuilds the file when resetWalletPassword does not report OK', async () => {
    // Covers the native-exception case too, where the response is a JSON
    // blob rather than a bare return code:
    const state = makeState({ filePassword: '', mnemonic: MNEMONIC })
    state.resetResult = '{"error":{"code":"INTERNAL_ERROR"}}'
    const bridge = makeBridge(state)

    const wallet = await bridge.startWallet(MNEMONIC, '', STORAGE_PATH)

    assert.equal(typeof wallet.wallet_id, 'number')
    assert.ok(state.calls.join('\n').includes('deleteWallet'))
    assert.equal(state.files.get(STORAGE_PATH)?.filePassword, DERIVED)
    // Only the rebuilt wallet syncs; the discarded legacy open never ran:
    assert.deepEqual([...(state.runningWallets ?? [])], [wallet.wallet_id])
  })

  it('leaves the file alone when it cannot release the wallet', async () => {
    // Closing is what writes the re-keyed file, so a failed close means the
    // migration never reached disk. It also means the wallet is still open on
    // that file, which makes deleting it the wrong move -- the legacy file is
    // intact, so the next start just tries the migration again:
    const state = makeState({ filePassword: '', mnemonic: MNEMONIC })
    state.closeResult = 'FAIL:disk full'
    const bridge = makeBridge(state)

    await assert.rejects(bridge.startWallet(MNEMONIC, '', STORAGE_PATH))

    assert.ok(!state.calls.join('\n').includes('deleteWallet'))
    assert.equal(state.files.get(STORAGE_PATH)?.filePassword, '')
  })

  it('keeps a migrated file when only the verifying re-open fails', async () => {
    // By this point `resetWalletPassword` and `closeWallet` have both
    // reported OK, so the file really is re-keyed. Deleting it because we
    // could not reopen it costs a full rescan to produce the same file.
    const state = makeState({ filePassword: '', mnemonic: MNEMONIC })
    state.openResults = [
      undefined, // the probe with the derived password
      undefined, // the legacy open
      JSON.stringify({
        id: 0,
        jsonrpc: '2.0',
        error: { code: 'INTERNAL_ERROR', message: '' }
      })
    ]
    const bridge = makeBridge(state)

    await assert.rejects(bridge.startWallet(MNEMONIC, '', STORAGE_PATH))

    assert.ok(!state.calls.join('\n').includes('deleteWallet'))
    assert.equal(state.files.get(STORAGE_PATH)?.filePassword, DERIVED)
  })

  it('still rebuilds when the re-open reports a wrong password', async () => {
    // The one case that does mean the re-key never reached disk, despite
    // both calls reporting OK.
    const state = makeState({ filePassword: '', mnemonic: MNEMONIC })
    state.openResults = [
      undefined,
      undefined,
      JSON.stringify({
        id: 0,
        jsonrpc: '2.0',
        error: { code: 'WRONG_PASSWORD', message: '' }
      })
    ]
    const bridge = makeBridge(state)

    const wallet = await bridge.startWallet(MNEMONIC, '', STORAGE_PATH)

    assert.ok(state.calls.join('\n').includes('deleteWallet'))
    assert.equal(state.files.get(STORAGE_PATH)?.filePassword, DERIVED)
    assert.deepEqual([...(state.runningWallets ?? [])], [wallet.wallet_id])
  })

  it('fails loudly when the delete leaves the file behind', async () => {
    // The native delete reports OK regardless. Restoring onto the surviving
    // file answers ALREADY_EXISTS, which callers recover from by adopting an
    // open wallet -- none is open, so they would rebuild forever.
    const state = makeState({
      filePassword: 'something else',
      mnemonic: MNEMONIC
    })
    state.deleteFails = true
    const bridge = makeBridge(state)

    await assert.rejects(
      bridge.startWallet(MNEMONIC, '', STORAGE_PATH),
      /Could not delete the Zano wallet file/
    )

    assert.ok(!state.calls.join('\n').includes('restore('))
  })

  it('rethrows ALREADY_EXISTS from the verifying re-open', async () => {
    // A concurrent open between our close and our re-open. The file is
    // already migrated at that point, and the caller recovers by adopting the
    // open wallet, so this must not fall through to the destructive rebuild:
    const state = makeState({ filePassword: '', mnemonic: MNEMONIC })
    state.openResults = [
      undefined, // the probe with the derived password
      undefined, // the legacy open
      JSON.stringify({
        id: 0,
        jsonrpc: '2.0',
        error: { code: 'ALREADY_EXISTS', message: '' }
      })
    ]
    const bridge = makeBridge(state)

    await assert.rejects(
      bridge.startWallet(MNEMONIC, '', STORAGE_PATH),
      (error: unknown) => {
        assert.ok(error instanceof ZanoError)
        assert.equal(error.code, 'ALREADY_EXISTS')
        return true
      }
    )

    assert.ok(!state.calls.join('\n').includes('deleteWallet'))
    // The re-key itself persisted, so the adopted wallet is on a migrated
    // file:
    assert.equal(state.files.get(STORAGE_PATH)?.filePassword, DERIVED)
  })

  it('re-keys a weak file even when a passphrase is supplied', async () => {
    // The detection this migration exists for: a wallet that has a seed
    // passphrase, whose 0.3.0 file was nonetheless keyed with the empty
    // string. The passphrase is tried first and fails, which must not be
    // read as a wrong passphrase -- '' is still to come.
    const state = makeState({ filePassword: '', mnemonic: MNEMONIC })
    const bridge = makeBridge(state)

    const wallet = await bridge.startWallet(MNEMONIC, 'hunter2', STORAGE_PATH)

    assert.equal(state.files.get(STORAGE_PATH)?.filePassword, DERIVED)
    assert.ok(!state.calls.join('\n').includes('deleteWallet'))
    assert.deepEqual([...(state.runningWallets ?? [])], [wallet.wallet_id])
    // Both candidates were tried, in order:
    const opens = state.calls.filter(call => call.startsWith('open('))
    assert.deepEqual(opens, [
      `open(${STORAGE_PATH},${DERIVED})`,
      `open(${STORAGE_PATH},hunter2)`,
      `open(${STORAGE_PATH},)`,
      `open(${STORAGE_PATH},${DERIVED})`
    ])
  })

  it('will not rebuild a weak file into a passphrase wallet', async () => {
    // The weak file opened with '', which says nothing about whether
    // 'hunter2' is this wallet's passphrase. If the re-key then fails,
    // rebuilding would restore from the mnemonic with 'hunter2' and write a
    // different wallet over the one we just had open.
    const state = makeState({ filePassword: '', mnemonic: MNEMONIC })
    state.resetResult = '{"error":{"code":"INTERNAL_ERROR"}}'
    const bridge = makeBridge(state)

    await assert.rejects(
      bridge.startWallet(MNEMONIC, 'hunter2', STORAGE_PATH),
      /written without this seed passphrase/
    )

    assert.ok(!state.calls.join('\n').includes('deleteWallet'))
    assert.equal(state.files.get(STORAGE_PATH)?.filePassword, '')
  })

  it('still rebuilds after a failed re-key of a matching passphrase file', async () => {
    // Here the passphrase did open the file, so restoring with it reproduces
    // the same wallet and the rebuild is safe.
    const state = makeState({ filePassword: 'hunter2', mnemonic: MNEMONIC })
    state.resetResult = '{"error":{"code":"INTERNAL_ERROR"}}'
    const bridge = makeBridge(state)

    const wallet = await bridge.startWallet(MNEMONIC, 'hunter2', STORAGE_PATH)

    assert.ok(state.calls.join('\n').includes('deleteWallet'))
    assert.equal(state.files.get(STORAGE_PATH)?.filePassword, DERIVED)
    assert.deepEqual([...(state.runningWallets ?? [])], [wallet.wallet_id])
  })

  it('throws rather than rebuilding when the passphrase is wrong', async () => {
    // The file is keyed with the real passphrase, and the caller supplies a
    // different one. Rebuilding here would delete a good file and restore a
    // different wallet from the same mnemonic.
    const state = makeState({ filePassword: 'hunter2', mnemonic: MNEMONIC })
    const bridge = makeBridge(state)

    await assert.rejects(
      bridge.startWallet(MNEMONIC, 'wrong-passphrase', STORAGE_PATH),
      /does not open with this seed passphrase/
    )

    assert.ok(!state.calls.join('\n').includes('deleteWallet'))
    assert.equal(state.files.get(STORAGE_PATH)?.filePassword, 'hunter2')
  })

  it('rebuilds the file when no known password opens it', async () => {
    const state = makeState({
      filePassword: 'something else',
      mnemonic: MNEMONIC
    })
    const bridge = makeBridge(state)

    const wallet = await bridge.startWallet(MNEMONIC, '', STORAGE_PATH)

    assert.ok(state.calls.join('\n').includes('deleteWallet'))
    assert.equal(state.files.get(STORAGE_PATH)?.filePassword, DERIVED)
    // The rebuilt wallet is the one that must sync -- dropping `started()`
    // on this path previously survived the whole suite:
    assert.deepEqual([...(state.runningWallets ?? [])], [wallet.wallet_id])
  })

  it('rethrows ALREADY_EXISTS with the historical message shape', async () => {
    // edge-currency-accountbased recovers from a concurrent open by
    // matching `error.message.includes('ALREADY_EXISTS')`:
    const state = makeState({ filePassword: DERIVED, mnemonic: MNEMONIC })
    state.openResult = JSON.stringify({
      id: 0,
      jsonrpc: '2.0',
      error: { code: 'ALREADY_EXISTS', message: '' }
    })
    const bridge = makeBridge(state)

    await assert.rejects(
      bridge.startWallet(MNEMONIC, '', STORAGE_PATH),
      (error: unknown) => {
        assert.ok(error instanceof ZanoError)
        assert.ok(error.message.includes('ALREADY_EXISTS'))
        assert.equal(error.code, 'ALREADY_EXISTS')
        return true
      }
    )
    // And it must not have fallen through to the delete-and-rebuild path:
    assert.ok(!state.calls.join('\n').includes('deleteWallet'))
  })

  it('does not try legacy passwords after a non-password failure', async () => {
    const state = makeState({ filePassword: DERIVED, mnemonic: MNEMONIC })
    state.openResult = JSON.stringify({
      id: 0,
      jsonrpc: '2.0',
      error: { code: 'INVALID_FILE', message: '' }
    })
    const bridge = makeBridge(state)

    await assert.rejects(bridge.startWallet(MNEMONIC, '', STORAGE_PATH))
    assert.equal(state.calls.filter(call => call.startsWith('open(')).length, 1)
  })

  it('reports migration through the optional log callback', async () => {
    const state = makeState({ filePassword: '', mnemonic: MNEMONIC })
    const bridge = makeBridge(state)
    const logged: string[] = []

    const wallet = await bridge.startWallet(MNEMONIC, '', STORAGE_PATH, {
      log: message => logged.push(message)
    })

    assert.ok(logged.some(line => line.includes('re-keyed')))
    assert.deepEqual([...(state.runningWallets ?? [])], [wallet.wallet_id])
  })
})

describe('generateSeedPhrase', () => {
  it('leaves no wallet file behind', async () => {
    const state = makeState()
    const bridge = makeBridge(state)

    const wallet = await bridge.generateSeedPhrase(
      'http://example.invalid',
      STORAGE_PATH,
      ''
    )

    assert.equal(typeof wallet.seed, 'string')
    assert.equal(state.files.size, 0)
  })

  it('postpones the refresh worker before generating', async () => {
    const state = makeState()
    const bridge = makeBridge(state)

    await bridge.generateSeedPhrase('http://example.invalid', STORAGE_PATH, '')

    // `generate` auto-starts the refresh worker unless postponed-run is
    // configured first, and the `closeWallet` below waits on the mutex that
    // worker holds, on the shared native-module queue.
    const configureIndex = state.calls.findIndex(call =>
      call.startsWith('syncCall(configure,')
    )
    const generateIndex = state.calls.findIndex(call =>
      call.startsWith('generate(')
    )
    assert.notEqual(configureIndex, -1, state.calls.join('\n'))
    assert.ok(
      configureIndex < generateIndex,
      `configure must precede generate: ${state.calls.join('\n')}`
    )
  })

  it('keeps the file when the close fails, rather than deleting it open', async () => {
    const state = makeState()
    state.closeResult = 'BUSY'
    const bridge = makeBridge(state)

    await assert.rejects(
      bridge.generateSeedPhrase('http://example.invalid', STORAGE_PATH, ''),
      /BUSY/
    )
    assert.ok(!state.calls.join('\n').includes('deleteWallet'))
  })
})
