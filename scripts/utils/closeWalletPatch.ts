const patchMarker = 'Edge patch: close-during-refresh deadlock'

const hint =
  'The SDK sources changed at this pin. If upstream has fixed the ' +
  'close-during-refresh lock inversion, delete this patch; otherwise port ' +
  'it to the new body.'

/**
 * `close_wallet` as pinned at zano_native_lib 91085c0, modulo invisible
 * trailing whitespace. The transform refuses to run unless the function it
 * found matches this byte-for-byte after trailing whitespace is stripped,
 * so ANY upstream drift - not just drift through the lines the deadlock
 * analysis rests on - fails the build for a human to re-evaluate.
 */
const original = `std::string wallets_manager::close_wallet(size_t wallet_id)
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

/**
 * The replacement `close_wallet`. The pinned original holds
 * `m_wallets_lock` exclusively across two waits on the wallet being
 * closed: the `store()` call, which needs the per-wallet lock the refresh
 * worker holds for the whole of a scan chunk, and the map erase, whose
 * destructor joins the worker thread. The refresh path re-enters the
 * manager through wallet callbacks (`on_transfer2`, `on_transfer_canceled`)
 * that take `m_wallets_lock` shared, and every other API call takes it
 * shared up front - so a close issued while the wallet is catching up
 * wedges the worker, the close, and then every Zano call in the process,
 * permanently. Thread dumps of the frozen app show the close parked inside
 * the native call, and no checkpoint ever lands again.
 *
 * The rewrite detaches the map node while holding the lock, then does the
 * slow parts - the store and the implicit thread join when the node dies
 * - with no manager lock held at all. Node extraction keeps the element
 * at its address, so the worker thread's references stay valid; wallet ids
 * are never reused, so late callbacks cannot hit a recycled id. The
 * log-prefix write gains a bounds check, because the manager lock no
 * longer serializes it against `reset()`'s vector clear.
 *
 * Deliberate semantics changes, all confined to the window after the node
 * leaves the map:
 *
 * - "Absent from `m_wallets`" no longer implies "closed and stored".
 *   During the store/join window the wallet is invisible to
 *   `open_wallet`'s ALREADY_EXISTS check and to status calls while its
 *   `wallet2` still writes the file. Safe for this bridge, which strictly
 *   sequences close-before-reopen per wallet on one executor thread; a
 *   caller without that discipline could double-open the file. Say so in
 *   any upstream submission.
 * - The refresh worker's own callbacks miss where they used to hit. Both
 *   `on_transfer2` and `on_transfer_canceled` look the wallet up by id
 *   under a shared `m_wallets_lock` while the store runs, and the entry is
 *   no longer there. Both lookups are checked - `on_transfer2` through
 *   `GET_WALLET_OPTIONS_BY_ID_VOID_RET`, which returns on a miss, and
 *   `on_transfer_canceled` with an explicit `end()` test that logs and
 *   returns - so the cost is a dropped view notification for a wallet
 *   that is closing anyway, not an unchecked dereference. Every
 *   `m_wallets.find` in the file is checked this way; the three bare
 *   `m_wallets[...]` sites all insert a freshly counted id in the open,
 *   restore and generate paths, and ids are never reused.
 * - When `store()` throws, the original left the entry in the map as a
 *   zombie (its stop flags already set, so it could never sync again);
 *   the rewrite reports the same error but the wallet is gone. A
 *   `closeWallet` retry therefore reports WALLET_WRONG_ID instead of
 *   retrying the store, so `CppBridge`'s re-key migration takes its
 *   "leave the file alone" branch with the wallet already released; the
 *   next launch retries the migration.
 *
 * iOS links the prebuilt `libzano-plain-wallet` framework and keeps the
 * original blocking semantics throughout.
 */
const replacement = `std::string wallets_manager::close_wallet(size_t wallet_id)
{
  // ${patchMarker}.
  //
  // The original held m_wallets_lock exclusively across store() and across
  // the map erase, whose destructor joins the refresh worker. Both wait on
  // a wallet that may be mid-refresh, and the refresh path re-enters the
  // manager through wallet callbacks that take m_wallets_lock shared - so
  // a close issued during a long refresh held the very lock the worker
  // needed to reach its stop flags, and neither side could ever proceed.
  // Detach the map node under the lock instead, then store and join with
  // no manager lock held. The node is declared outside the try so its
  // destructor - which joins the worker thread the stop flags told to
  // finish - runs at function exit rather than during unwinding, while
  // everything that can throw stays inside the try, so failures keep
  // reporting as return codes exactly as they did before this patch.
  decltype(m_wallets)::node_type wallet_node;
  try
  {
    {
      EXCLUSIVE_CRITICAL_REGION_LOCAL(m_wallets_lock);

      auto it = m_wallets.find(wallet_id);
      if (it == m_wallets.end())
        return API_RETURN_CODE_WALLET_WRONG_ID;

      it->second.major_stop = true;
      it->second.stop_for_refresh = true;
      it->second.w.unlocked_get()->stop();
      wallet_node = m_wallets.extract(it);
    }

    wallet_node.mapped().w->get()->store();
    {
      CRITICAL_REGION_LOCAL(m_wallet_log_prefixes_lock);
      // The manager lock no longer serializes this write against reset()'s
      // clear of the vector, so respect its current size:
      if (wallet_id < m_wallet_log_prefixes.size())
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

/** Strips trailing whitespace per line, the one formatting freedom the
 * comparison allows - the pinned file carries an invisible trailing
 * space that transcriptions of it should not have to reproduce. `\r` is
 * in the class so a CRLF checkout reports the drift it has, rather than
 * one carriage return per line. */
function normalize(code: string): string {
  return code
    .split('\n')
    .map(line => line.replace(/[ \t\r]+$/, ''))
    .join('\n')
}

/**
 * Rewrites the SDK's `wallets_manager::close_wallet` so it does not hold
 * the wallet-manager lock while waiting on the wallet being closed. See
 * the comment on `replacement` above for the deadlock this removes and
 * the semantics it deliberately changes.
 *
 * Only the Android libraries pick this up: iOS links the prebuilt
 * `libzano-plain-wallet` xcframework rather than building these sources,
 * and iOS runs the same close-during-catch-up cycle without wedging.
 *
 * The function is located by its unique signature, delimited by brace
 * counting, and then required to match the pinned original exactly
 * (modulo trailing whitespace), so a pin bump that changes `close_wallet`
 * in any way fails the build here instead of silently keeping (or
 * dropping) a stale patch. The brace counter would be fooled by a brace
 * inside a string literal, but the full-body comparison catches that case
 * too: a mis-delimited body cannot match the original.
 *
 * @param text - The contents of the SDK's `wallets_manager.cpp`.
 * @returns The patched contents. Already-patched input comes back
 * unchanged, so the caller does not need to track whether it ran.
 */
export function patchCloseWallet(text: string): string {
  if (text.includes(patchMarker)) return text

  const anchor = 'std::string wallets_manager::close_wallet(size_t wallet_id)'
  const start = text.indexOf(anchor)
  if (start < 0 || text.includes(anchor, start + 1)) {
    throw new Error(
      `Cannot find a unique wallets_manager::close_wallet to patch. ${hint}`
    )
  }

  // Take the whole function by brace balance:
  let depth = 0
  let end = -1
  for (let i = text.indexOf('{', start); i >= 0 && i < text.length; ++i) {
    if (text[i] === '{') ++depth
    if (text[i] === '}' && --depth === 0) {
      end = i + 1
      break
    }
  }
  if (end < 0) {
    throw new Error(
      `Cannot delimit the body of wallets_manager::close_wallet. ${hint}`
    )
  }

  if (normalize(text.slice(start, end)) !== normalize(original)) {
    throw new Error(
      'wallets_manager::close_wallet does not match the pinned original ' +
        `this patch was written against. ${hint}`
    )
  }

  return text.slice(0, start) + replacement + text.slice(end)
}
