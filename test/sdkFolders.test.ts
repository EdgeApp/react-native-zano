import { strict as assert } from 'assert'

import { findSdkFolders } from '../scripts/utils/sdkFolders'

// The declarations as they appear in the SDK's `plain_wallet_api.cpp`,
// verified identical at zano_native_lib 239d4a39 and 91085c0.
const REAL_DEFINES = `
#define ANDROID_PACKAGE_NAME    "com.zano_mobile"

#define LOGS_FOLDER             "logs"

#define WALLETS_FOLDER_NAME     "wallets"
#define APP_CONFIG_FOLDER       "app_config"
#define APP_CONFIG_FILENAME     "app_cfg.bin"
`

describe('findSdkFolders', () => {
  it('finds the directories the SDK declares', () => {
    assert.deepEqual(findSdkFolders(REAL_DEFINES), [
      'app_config',
      'logs',
      'wallets'
    ])
  })

  it('ignores defines that are not folders', () => {
    // `APP_CONFIG_FILENAME` names a file inside app_config, and
    // `ANDROID_PACKAGE_NAME` is not a path at all:
    const found = findSdkFolders(REAL_DEFINES)
    assert.ok(!found.includes('app_cfg.bin'))
    assert.ok(!found.includes('com.zano_mobile'))
  })

  it('reports a directory added by a future SDK', () => {
    // The whole point of the check: a new folder must show up here so the
    // build fails and someone adds it to the iOS backup-exclusion list.
    const found = findSdkFolders(
      `${REAL_DEFINES}\n#define CACHE_FOLDER            "cache"\n`
    )
    assert.ok(found.includes('cache'))
  })

  it('matches a folder define under any naming convention', () => {
    assert.deepEqual(findSdkFolders('#define SOMETHING_DIR "thing"\n'), [
      'thing'
    ])
  })

  it('throws rather than silently passing when nothing matches', () => {
    // A rewrite of how the SDK declares directories must fail loudly; an
    // empty result would otherwise read as "no new folders".
    assert.throws(
      () => findSdkFolders('#define APP_CONFIG_FILENAME "app_cfg.bin"\n'),
      /needs updating/
    )
  })
})
