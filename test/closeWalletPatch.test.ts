import { strict as assert } from 'assert'

import { patchCloseWallet } from '../scripts/utils/closeWalletPatch'

// The function as it appears in the SDK's `wallets_manager.cpp` at
// zano_native_lib 91085c0, modulo invisible trailing whitespace, the one
// difference the full-body comparison forgives. This is an independent
// transcription: the suite passing proves it agrees with the copy the
// transform itself pins.
const REAL_CLOSE_WALLET = `std::string wallets_manager::close_wallet(size_t wallet_id)
{
  EXCLUSIVE_CRITICAL_REGION_LOCAL(m_wallets_lock);

  auto it = m_wallets.find(wallet_id);
  if (it == m_wallets.end())
    return API_RETURN_CODE_WALLET_WRONG_ID;


  try
  {
    it->second.major_stop = true;
    it->second.stop_for_refresh = true;
    it->second.w.unlocked_get()->stop();

    it->second.w->get()->store();
    m_wallets.erase(it);
    {
      CRITICAL_REGION_LOCAL(m_wallet_log_prefixes_lock);
      m_wallet_log_prefixes[wallet_id] = std::string("[") + epee::string_tools::num_to_string_fast(wallet_id) + ":CLOSED] ";
    }
  }

  catch (const std::exception& e)
  {
    return std::string(API_RETURN_CODE_FAIL) + ":" + e.what();
  }
  catch (...)
  {
    return API_RETURN_CODE_INTERNAL_ERROR;
  }
  //m_pview->hide_wallet();
  return API_RETURN_CODE_OK;
}`

const before = 'std::string wallets_manager::open_wallet() { return ""; }\n\n'
const after = '\n\nvoid wallets_manager::init_wallet_entry() { }\n'
const REAL_FILE = before + REAL_CLOSE_WALLET + after

describe('patchCloseWallet', () => {
  it('rewrites the pinned close_wallet', () => {
    const patched = patchCloseWallet(REAL_FILE)

    // The deadlock shape is gone: nothing slow runs under the lock...
    assert.ok(!patched.includes('m_wallets.erase(it)'))
    assert.ok(patched.includes('wallet_node = m_wallets.extract(it)'))

    // ...and the store happens against the detached node:
    assert.ok(patched.includes('wallet_node.mapped().w->get()->store()'))
  })

  it('keeps the rest of the file untouched', () => {
    const patched = patchCloseWallet(REAL_FILE)
    assert.ok(patched.startsWith(before))
    assert.ok(patched.endsWith(after))
  })

  it('keeps the behavior around the deadlock fix verbatim', () => {
    const patched = patchCloseWallet(REAL_FILE)

    // Stop flags, the store, the log-prefix update, and the return codes
    // all survive; only the locking around them changes:
    for (const kept of [
      'major_stop = true;',
      'stop_for_refresh = true;',
      'w.unlocked_get()->stop();',
      'EXCLUSIVE_CRITICAL_REGION_LOCAL(m_wallets_lock);',
      'CRITICAL_REGION_LOCAL(m_wallet_log_prefixes_lock);',
      ':CLOSED] ',
      'API_RETURN_CODE_WALLET_WRONG_ID',
      'API_RETURN_CODE_FAIL',
      'API_RETURN_CODE_INTERNAL_ERROR',
      'API_RETURN_CODE_OK'
    ]) {
      assert.ok(patched.includes(kept), `patched close_wallet lost ${kept}`)
    }
  })

  it('bounds-checks the log-prefix write it moves off the manager lock', () => {
    // The original wrote m_wallet_log_prefixes[wallet_id] while holding
    // m_wallets_lock exclusively, which serialized it against reset()'s
    // vector clear. The rewrite's write is outside that lock, so it must
    // respect the vector's current size:
    const patched = patchCloseWallet(REAL_FILE)
    assert.ok(patched.includes('if (wallet_id < m_wallet_log_prefixes.size())'))
  })

  it('keeps every throwing step inside the try', () => {
    // The original reported failures as return codes, and callers branch
    // on those. Anything that escapes close_wallet instead surfaces as a
    // thrown Java exception, which reaches JS as a rejected promise rather
    // than a resolved `{ response: 'FAIL:...' }`:
    const patched = patchCloseWallet(REAL_FILE)
    const body = patched.slice(
      patched.indexOf('close_wallet(size_t wallet_id)')
    )
    // The statement, not the word where the comment above explains it:
    const tryAt = body.indexOf('\n  try\n  {')
    assert.ok(tryAt > 0)
    for (const throwing of [
      'EXCLUSIVE_CRITICAL_REGION_LOCAL(m_wallets_lock);',
      'w.unlocked_get()->stop();',
      'm_wallets.extract(it)',
      'store();'
    ]) {
      assert.ok(
        body.indexOf(throwing) > tryAt,
        `${throwing} runs outside the try`
      )
    }
    // ...but the node itself is declared outside it, so the worker join in
    // its destructor runs at function exit rather than during unwinding:
    assert.ok(body.indexOf('node_type wallet_node;') < tryAt)
  })

  it('is idempotent', () => {
    const patched = patchCloseWallet(REAL_FILE)
    assert.equal(patchCloseWallet(patched), patched)
  })

  it('accepts a CRLF checkout of the pinned source', () => {
    // A CRLF working tree must not read as upstream drift:
    const crlf = REAL_FILE.replace(/\n/g, '\r\n')
    assert.ok(patchCloseWallet(crlf).includes('m_wallets.extract(it)'))
  })

  it('tolerates trailing whitespace differences from the pin', () => {
    // The pinned file carries an invisible trailing space; the comparison
    // must not depend on reproducing it:
    const spaced = REAL_FILE.replace(
      'EXCLUSIVE_CRITICAL_REGION_LOCAL(m_wallets_lock);\n',
      'EXCLUSIVE_CRITICAL_REGION_LOCAL(m_wallets_lock);  \n'
    )
    assert.ok(patchCloseWallet(spaced).includes('m_wallets.extract(it)'))
  })

  it('throws when close_wallet is missing', () => {
    // A pin bump that renames or removes the function must fail the build
    // rather than shipping Android libraries with the deadlock back:
    assert.throws(
      () => patchCloseWallet(before + after),
      /Cannot find a unique/
    )
  })

  it('throws when close_wallet appears twice', () => {
    assert.throws(
      () => patchCloseWallet(REAL_FILE + '\n' + REAL_CLOSE_WALLET),
      /Cannot find a unique/
    )
  })

  it('throws when the body no longer matches the pin', () => {
    // An upstream rewrite - including the fix we hope they ship - must
    // force a human to re-evaluate this patch rather than silently
    // stacking on top of it:
    const changed = REAL_FILE.replace(
      'm_wallets.erase(it);',
      'erase_wallet(it);'
    )
    assert.throws(() => patchCloseWallet(changed), /pinned original/)
  })

  it('throws on any drift, not just drift through load-bearing lines', () => {
    // A new statement that leaves the analyzed lines intact still changes
    // what the function does, and must not be silently discarded:
    const drifted = REAL_FILE.replace(
      'm_wallets.erase(it);',
      'm_wallets.erase(it);\n    ++m_close_count;'
    )
    assert.throws(() => patchCloseWallet(drifted), /pinned original/)
  })
})
