import { strict as assert } from 'assert'

import { CppBridge } from '../src/CppBridge'
import { ZanoError } from '../src/types'
import { FakeState, makeFakeZanoModule } from './fakeZanoModule'

const MNEMONIC = 'like like like'
const STORAGE_PATH = 'AA'

const makeBridge = (state: FakeState): CppBridge =>
  new CppBridge(makeFakeZanoModule(state))

describe('native error handling', () => {
  it('rejects a success-shaped INTERNAL_ERROR payload', async () => {
    // PLAIN_WALLET_CATCH reports C++ exceptions as
    // `{result: {return_code: "INTERNAL_ERROR <what>"}}`, which passes a
    // naive `'result' in response` check and yields a wallet whose
    // `wallet_id` is undefined. Callers would cache that as an open wallet.
    const state: FakeState = { calls: [], files: new Map() }
    state.openResult = JSON.stringify({
      id: 0,
      jsonrpc: '2.0',
      result: { return_code: 'INTERNAL_ERROR boom' }
    })
    state.files.set(STORAGE_PATH, { filePassword: '', mnemonic: MNEMONIC })
    const bridge = makeBridge(state)

    await assert.rejects(
      bridge.startWallet(MNEMONIC, '', STORAGE_PATH),
      (error: unknown) => {
        assert.ok(error instanceof ZanoError)
        assert.equal(error.code, 'INTERNAL_ERROR')
        return true
      }
    )
  })

  it('rejects a success-shaped UNINITIALIZED payload', async () => {
    // GET_INSTANCE_PTR returns this shape whenever `init` has not run:
    const state: FakeState = { calls: [], files: new Map() }
    state.openResult = JSON.stringify({
      id: 0,
      jsonrpc: '2.0',
      result: { return_code: 'UNINITIALIZED' }
    })
    state.files.set(STORAGE_PATH, { filePassword: '', mnemonic: MNEMONIC })
    const bridge = makeBridge(state)

    await assert.rejects(
      bridge.startWallet(MNEMONIC, '', STORAGE_PATH),
      (error: unknown) => {
        assert.ok(error instanceof ZanoError)
        assert.equal(error.code, 'UNINITIALIZED')
        return true
      }
    )
  })

  it('keeps the historical error message shape, trailing space included', () => {
    // The previous implementation threw `Error(`${code} ${message}`)`, and
    // downstream matches on substrings of that. An empty message leaves a
    // trailing space; do not "tidy" it away.
    const error = new ZanoError('WRONG_PASSWORD', '')
    assert.equal(error.message, 'WRONG_PASSWORD ')
  })

  it('parses the bare code out of detail-packed return codes', () => {
    assert.equal(new ZanoError('FAIL:disk full').code, 'FAIL')
    assert.equal(
      new ZanoError('INTERNAL_ERROR, DESCRIPTION: boom').code,
      'INTERNAL_ERROR'
    )
    assert.equal(new ZanoError('WRONG_PASSWORD').code, 'WRONG_PASSWORD')
  })
})
