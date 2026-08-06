/**
 * Directories the Zano SDK creates under the working directory the app hands
 * it, and that `ios/ZanoModule.mm` therefore has to pre-create so it can
 * exclude them from device backups -- the wallet files hold the seed and
 * spend keys.
 *
 * Keep this in sync with the `prepareZanoDirectory` calls in
 * `ios/ZanoModule.mm`. `update-sources.ts` fails the build if the SDK
 * declares a directory that is missing here.
 */
export const sdkFolders = ['app_config', 'logs', 'wallets']

/**
 * Extracts the directory names the SDK declares, sorted.
 *
 * Matches `#define`s whose name mentions a folder, so `APP_CONFIG_FOLDER`
 * and `WALLETS_FOLDER_NAME` count but `APP_CONFIG_FILENAME` does not.
 *
 * This catches directories declared as `#define`d names, which is how the
 * SDK has always declared them. It cannot catch a path composed inline, so
 * it is a tripwire rather than a proof.
 *
 * @param apiText - The contents of the SDK's `plain_wallet_api.cpp`.
 * @throws If nothing matches at all, which means the SDK changed how it
 * declares directories and this check needs rewriting rather than silently
 * reporting "no new folders".
 */
export function findSdkFolders(apiText: string): string[] {
  const found = new Set<string>()
  const regexp = /^#define\s+\w*(?:FOLDER|_DIR)\w*\s+"([^"]*)"/gm
  let match: RegExpExecArray | null
  while ((match = regexp.exec(apiText)) != null) {
    found.add(match[1])
  }

  if (found.size === 0) {
    throw new Error(
      'Found no folder definitions in plain_wallet_api.cpp. The SDK has ' +
        'probably changed how it declares them, so this check needs updating.'
    )
  }

  return [...found].sort((a, b) => a.localeCompare(b))
}
