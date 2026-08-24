import { strict as assert } from 'assert'

import { CppBridge } from '../src/CppBridge'
import { FakeState, makeFakeZanoModule } from './fakeZanoModule'

// Destination addresses are opaque strings to this layer: since HF6 the
// native wallet resolves any embedded payment id itself, so the bridge
// neither parses nor looks up addresses.
const INTEGRATED_A = 'iZFakeIntegratedA'
const INTEGRATED_B = 'iZFakeIntegratedB'

const makeState = (): FakeState => ({
  calls: [],
  files: new Map()
})

const makeBridge = (state: FakeState): CppBridge =>
  new CppBridge(makeFakeZanoModule(state))

const sendTo = (
  recipients: string[]
): {
  transfers: Array<{ assetId: string; nativeAmount: number; recipient: string }>
  fee: number
} => ({
  transfers: recipients.map(recipient => ({
    assetId: 'ASSET',
    nativeAmount: 100,
    recipient
  })),
  fee: 10
})

describe('transfer', () => {
  it('never sends a request-level payment id', async () => {
    // Since HF6 the node rejects any non-empty tx-wide `payment_id`; the id
    // rides inside the integrated address and native attaches it.
    const state = makeState()
    const bridge = makeBridge(state)

    const txHash = await bridge.transfer(1, sendTo([INTEGRATED_A]))

    assert.equal(txHash, 'FAKE_TX_HASH')
    assert.equal(state.transferRequests?.length, 1)
    assert.equal(state.transferRequests?.[0].payment_id, '')
    assert.equal(
      state.transferRequests?.[0].destinations[0].address,
      INTEGRATED_A
    )
    // The id needs no resolution here at all; the send path makes no
    // per-destination getAddressInfo round-trips:
    assert.ok(!state.calls.join('\n').includes('getAddressInfo'))
  })

  it('allows several integrated destinations with different ids', async () => {
    // Legal since HF6: one transaction may pay multiple integrated
    // addresses, each output carrying its own intrinsic id. The old
    // one-id-per-transaction rule predates that.
    const state = makeState()
    const bridge = makeBridge(state)

    await bridge.transfer(1, sendTo([INTEGRATED_A, INTEGRATED_B]))

    assert.equal(state.transferRequests?.length, 1)
    assert.equal(state.transferRequests?.[0].payment_id, '')
    assert.equal(state.transferRequests?.[0].destinations.length, 2)
  })
})
