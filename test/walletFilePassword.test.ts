import { strict as assert } from 'assert'

import { deriveWalletFilePassword } from '../src/walletFilePassword'

const MNEMONIC =
  'like like like like like like like like like like like like like like like like like like like like like like like like shoulder mom'

// Zano's own limit: 40 characters over a restricted alphabet
// (PASSWORD_REGEXP in currency_format_utils.cpp).
const ZANO_PASSWORD_REGEX =
  /^[A-Za-z0-9~!?@#$%^&*_+|{}[\]()<>:;"'\-=/.,]{1,40}$/

describe('deriveWalletFilePassword', () => {
  it('matches its golden vector', () => {
    // Changing the derivation orphans every wallet file already encrypted
    // with it, forcing a delete-and-restore. This vector pins it; if it
    // ever needs to change, the old derivation must join startWallet's
    // legacy-password list.
    assert.equal(
      deriveWalletFilePassword(MNEMONIC),
      '3e2bcd5f6b07dd1134fb4dc6aceb1e1c'
    )
  })

  it('stays inside the Zano password rules', () => {
    assert.match(deriveWalletFilePassword(MNEMONIC), ZANO_PASSWORD_REGEX)
  })

  it('ignores whitespace differences in the mnemonic', () => {
    // Stored mnemonics carry whatever spacing the user or scanner produced:
    const messy = `  ${MNEMONIC.replace(/ /g, '   ')}  `
    assert.equal(
      deriveWalletFilePassword(messy),
      deriveWalletFilePassword(MNEMONIC)
    )
  })

  it('changes with the mnemonic', () => {
    assert.notEqual(
      deriveWalletFilePassword(MNEMONIC.replace('mom', 'dad')),
      deriveWalletFilePassword(MNEMONIC)
    )
  })

  it('never returns the empty string or echoes its input', () => {
    const password = deriveWalletFilePassword(MNEMONIC)
    assert.notEqual(password, '')
    assert.notEqual(password, MNEMONIC)
  })
})
