// Run this script as `node -r sucrase/register ./scripts/build-native-host.ts`
//
// Builds a Node N-API addon for the current host:
// - Fetches zano_native_lib (macOS plain-wallet xcframework via Git LFS)
// - Compiles zano-methods.cpp and relocatable-links against the prebuilt
// - Archives to zano-module.a, then node-gyp produces
//   prebuilds/<platform>-<arch>/zano.node

import { copyFile, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'

import {
  captureExec,
  fileExists,
  getRepo,
  loudExec,
  quietExec,
  tmpPath
} from './utils/common'
import { getObjcopyPath } from './utils/ios-tools'

const srcPath = join(__dirname, '../src')
const zanoNativeHash = '91085c0ebd95fcdae3327071a9e5f5b615d7da3d'

interface XcframeworkPlist {
  AvailableLibraries: Array<{
    HeadersPath?: string
    LibraryIdentifier: string
    LibraryPath: string
    SupportedArchitectures: string[]
    SupportedPlatform: string
    SupportedPlatformVariant?: string
  }>
}

/**
 * Locates the slice of a prebuilt macOS xcframework that matches this arch.
 */
async function findMacosXcframeworkSlice(
  frameworkPath: string,
  arch: string
): Promise<{ headersPath: string; libraryPath: string }> {
  const plist: XcframeworkPlist = JSON.parse(
    await captureExec('plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      join(frameworkPath, 'Info.plist')
    ])
  )

  const slice = plist.AvailableLibraries.find(
    library =>
      library.SupportedPlatform === 'macos' &&
      library.SupportedArchitectures.includes(arch)
  )
  if (slice == null) {
    throw new Error(
      `${frameworkPath} has no macos slice for ${arch}. It offers: ${plist.AvailableLibraries.map(
        library => library.LibraryIdentifier
      ).join(', ')}`
    )
  }

  const slicePath = join(frameworkPath, slice.LibraryIdentifier)
  const libraryPath = join(slicePath, slice.LibraryPath)

  const archs = (await captureExec('lipo', ['-archs', libraryPath])).split(
    /\s+/
  )
  if (!archs.includes(arch)) {
    throw new Error(
      `${libraryPath} holds ${archs.join(', ')}, but we are building ${arch}`
    )
  }

  return {
    headersPath: join(slicePath, slice.HeadersPath ?? 'Headers'),
    libraryPath
  }
}

async function downloadSources(): Promise<void> {
  await getRepo(
    'zano_native_lib',
    'https://github.com/hyle-team/zano_native_lib.git',
    zanoNativeHash,
    // Host builds only need the macOS plain-wallet prebuild (+ headers inside):
    { lfsIncludes: ['_install_macosx/**'] }
  )

  // Rename the compress function in RIPEMD160.c,
  // since that conflicts with Zlib (same patch as update-sources.ts):
  const mdPath = join(tmpPath, 'zano_native_lib/Zano/src/crypto/RIPEMD160.h')
  if (await fileExists(mdPath)) {
    const mdText = await readFile(mdPath, 'utf8')
    if (!mdText.includes('#define compress md_compress')) {
      await writeFile(mdPath, '#define compress md_compress\n' + mdText)
    }
  }
}

/**
 * Compiles the wrapper and links it against the prebuilt macOS
 * libzano-plain-wallet static library into zano-module.a.
 */
async function buildHostStaticLib(arch: string): Promise<string> {
  const working = join(tmpPath, `host-darwin-${arch}`)
  await mkdir(working, { recursive: true })

  const { headersPath, libraryPath: zanoLib } = await findMacosXcframeworkSlice(
    join(tmpPath, 'zano_native_lib/_install_macosx/libzano-plain-wallet.xcframework'),
    arch
  )

  const ar = await quietExec('xcrun', ['--find', 'ar'])
  const cxx = await quietExec('xcrun', ['--find', 'clang++'])
  const ld = await quietExec('xcrun', ['--find', 'ld'])
  const objcopy = await getObjcopyPath()
  const sysroot = await quietExec('xcrun', ['--show-sdk-path'])

  const sdkFlags = [
    '-arch',
    arch,
    '-isysroot',
    sysroot,
    '-mmacosx-version-min=11.0'
  ]
  const cxxflags = [
    `-I${headersPath}`,
    '-O2',
    '-std=c++17',
    '-fPIC',
    '-fexceptions'
  ]

  const source = 'zano-wrapper/zano-methods.cpp'
  const object = join(working, 'zano-methods.o')
  console.log(`Compiling ${source} for host-darwin-${arch}...`)
  await loudExec(cxx, [
    '-c',
    ...cxxflags,
    ...sdkFlags,
    `-o${object}`,
    join(srcPath, source)
  ])

  // Relocatable link against the prebuilt plain-wallet archive
  // (same approach as iOS in update-sources.ts):
  console.log(`Linking zano-module.o for host-darwin-${arch}`)
  const objectPath = join(working, 'zano-module.o')
  await loudExec(ld, [
    '-r',
    '-arch',
    arch,
    '-o',
    objectPath,
    object,
    zanoLib
  ])

  // Localize all symbols except the ones we export to the N-API addon:
  await loudExec(objcopy, [
    objectPath,
    '-w',
    '-L*',
    '-L!_zanoMethods',
    '-L!_zanoMethodCount'
  ])

  const library = join(working, 'libzano-module.a')
  await rm(library, { force: true })
  await loudExec(ar, ['rcs', library, objectPath])
  console.log(`Built ${library}`)
  return library
}

async function buildNodeAddon(staticLib: string): Promise<void> {
  const prebuildDir = join(
    __dirname,
    '../prebuilds',
    `${process.platform}-${process.arch}`
  )
  await mkdir(prebuildDir, { recursive: true })

  const napiInclude = String(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(join(__dirname, '../node_modules/node-addon-api')).include
  ).replace(/"/g, '')

  const gypDir = join(tmpPath, 'nodeaddon')
  await mkdir(gypDir, { recursive: true })
  // node-gyp/make cannot compile sources given as absolute paths.
  await copyFile(
    join(__dirname, '../src/node/zano-napi.cpp'),
    join(gypDir, 'zano-napi.cpp')
  )

  const gyp = {
    targets: [
      {
        target_name: 'zano',
        sources: ['zano-napi.cpp'],
        include_dirs: [napiInclude, join(__dirname, '../src/zano-wrapper')],
        defines: ['NAPI_CPP_EXCEPTIONS'],
        'cflags!': ['-fno-exceptions'],
        'cflags_cc!': ['-fno-exceptions'],
        cflags_cc: ['-std=c++17', '-fPIC'],
        libraries: [staticLib],
        xcode_settings: {
          GCC_ENABLE_CPP_EXCEPTIONS: 'YES',
          CLANG_CXX_LANGUAGE_STANDARD: 'c++17',
          MACOSX_DEPLOYMENT_TARGET: '11.0',
          OTHER_LDFLAGS: ['-lc++', '-lz']
        }
      }
    ]
  }
  await writeFile(join(gypDir, 'binding.gyp'), JSON.stringify(gyp, null, 2))

  const nodeGyp = join(__dirname, '../node_modules/.bin/node-gyp')
  await loudExec(nodeGyp, ['rebuild'], { cwd: gypDir })

  const built = join(gypDir, 'build/Release/zano.node')
  await loudExec('cp', [built, join(prebuildDir, 'zano.node')])
  console.log(`Wrote ${join(prebuildDir, 'zano.node')}`)
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error(
      `Host Zano builds are currently only supported on darwin (got ${process.platform}). ` +
        'Linux would need _install_linux plain-wallet libs from zano_native_lib.'
    )
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  await mkdir(tmpPath, { recursive: true })
  await downloadSources()
  const staticLib = await buildHostStaticLib(arch)
  await buildNodeAddon(staticLib)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
