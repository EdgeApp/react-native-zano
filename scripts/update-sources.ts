// Run this script as `node -r sucrase/register ./scripts/update-sources.ts`
//
// It will:
// - Download third-party source code.
// - Assemble Android shared libraries for each platform.
// - Assemble an iOS universal static xcframework.
//
// Here is where each puzzle piece comes from:
//
// |         | Zano  | OpenSSL           | Boost             |
// |---------|-------|-------------------|-------------------|
// | Android | CMake | zano_native_lib   | Boost-for-Android |
// | iOS     | CMake | OpenSSL-Universal | zano_native_lib   |
//
// For both iOS and Android, we build Zano by invoking CMake directly.
// The zano_native_lib build scripts aren't really useful,
// since the aren't geared towards React Native auto-linking.
// Calling CMake ourselves isn't that hard.
//
// On Android, the zano_native_lib OpenSSL libraries in are fine,
// but we have to use Boost-for-Android to get the right STL version.
//
// On iOS, the boost libraries are fine,
// but their OpenSSL is just a re-packaged copy OpenSSL-Universal,
// so it's simpler to pull that in from CocoaPods directly.
//

import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { cpus } from 'os'
import { join } from 'path'

import { getNdkPath } from './utils/android-tools'
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

async function main(): Promise<void> {
  await mkdir(tmpPath, { recursive: true })
  await downloadSources()

  // Android:
  await buildAndroidBoost()
  for (const platform of androidPlatforms) {
    await buildAndroidZano(platform)
  }

  // iOS:
  for (const platform of iosPlatforms) {
    await buildIosZano(platform)
  }
  await packageIosZano()
}

async function downloadSources(): Promise<void> {
  await getRepo(
    'zano_native_lib',
    'https://github.com/hyle-team/zano_native_lib.git',
    '91085c0ebd95fcdae3327071a9e5f5b615d7da3d'
  )
  await getRepo(
    'Boost-for-Android',
    'https://github.com/moritz-wundke/Boost-for-Android.git',
    '51924ec5533a4fefb5edf99feaeded794c06a4fb'
  )

  // Rename the compress function in RIPEMD160.c,
  // since that conflicts with Zlib:
  const mdPath = join(tmpPath, 'zano_native_lib/Zano/src/crypto/RIPEMD160.h')
  const mdText = await readFile(mdPath, 'utf8')
  await writeFile(mdPath, '#define compress md_compress\n' + mdText)
}

// Compiler options:
const includePaths: string[] = ['zano_native_lib/Zano/src/wallet']

// Source list (from src/):
const sources: string[] = ['zano-wrapper/zano-methods.cpp']

// .a files from Zano:
const zanoLibs = ['common', 'crypto', 'currency_core', 'wallet', 'z']

// .a files from boost:
const boostLibs = [
  'atomic',
  'chrono',
  'date_time',
  'filesystem',
  'program_options',
  'regex',
  'serialization',
  'system',
  'thread',
  'timer'
]

interface AndroidPlatform {
  arch: string
  triple: string
}

interface IosPlatform {
  sdk: 'iphoneos' | 'iphonesimulator'
  arch: string
  cmakePlatform: string
}

const androidPlatforms: AndroidPlatform[] = [
  { arch: 'arm64-v8a', triple: 'aarch64-linux-android33' },
  { arch: 'armeabi-v7a', triple: 'armv7a-linux-androideabi23' },
  { arch: 'x86', triple: 'i686-linux-android23' },
  { arch: 'x86_64', triple: 'x86_64-linux-android23' }
]

// Phones and simulators we need to support:
const iosPlatforms: IosPlatform[] = [
  { sdk: 'iphoneos', arch: 'arm64', cmakePlatform: 'OS64' },
  { sdk: 'iphonesimulator', arch: 'arm64', cmakePlatform: 'SIMULATORARM64' },
  { sdk: 'iphonesimulator', arch: 'x86_64', cmakePlatform: 'SIMULATOR64' }

  // Zano does not support these:
  // { sdk: 'iphoneos', arch: 'armv7' },
  // { sdk: 'iphoneos', arch: 'armv7s' },
]
const iosSdkTriples: { [sdk: string]: string } = {
  iphoneos: '%arch%-apple-ios13.0',
  iphonesimulator: '%arch%-apple-ios13.0-simulator'
}

/**
 * We compile our own Boost for Android,
 * because the Zano one is linking with the static STL library,
 * but we need to link with the shared STL library.
 */
async function buildAndroidBoost(): Promise<void> {
  const boostExists = await fileExists(
    join(tmpPath, 'Boost-for-Android/build/out/arm64-v8a/lib/libboost_atomic.a')
  )
  if (boostExists) return

  const ndkPath = await getNdkPath()
  await loudExec(
    './build-android.sh',
    [
      `--arch=${androidPlatforms.map(platform => platform.arch).join(',')}`,
      '--boost=1.84.0',
      `--with-libraries=${boostLibs.join(',')}`,
      '--layout=system',
      ndkPath
    ],
    { cwd: join(tmpPath, 'Boost-for-Android') }
  )
}

/**
 * Invokes CMake to build Zano,
 * followed by clang++ to build the shared library.
 */
async function buildAndroidZano(platform: AndroidPlatform): Promise<void> {
  const { arch, triple } = platform
  const ndkPath = await getNdkPath()
  const working = join(tmpPath, `android-${arch}`)
  const boostPath = join(tmpPath, 'Boost-for-Android/build/out/', arch)
  const sslPath = join(tmpPath, 'zano_native_lib/_libs_android/openssl')
  const zanoLibPath = join(tmpPath, `android-${arch}/${arch}/lib/`)

  // Build Zano itself:
  await loudExec('cmake', [
    // Source directory:
    `-S${join(tmpPath, 'zano_native_lib/Zano')}`,
    // Build directory:
    `-B${join(working, 'cmake')}`,
    // Build options:
    `-DBoost_INCLUDE_DIRS=${join(boostPath, 'include')}`,
    `-DBoost_LIBRARY_DIRS=${join(boostPath, 'lib')}`,
    `-DBoost_VERSION="1.84.0"`,
    `-DCMAKE_ANDROID_ARCH_ABI=${arch}`,
    `-DCMAKE_ANDROID_NDK=${ndkPath}`,
    `-DCMAKE_ANDROID_STL_TYPE=c++_shared`,
    `-DCMAKE_BUILD_TYPE=Release`,
    `-DCMAKE_INSTALL_PREFIX=${working}`,
    `-DCMAKE_SYSTEM_NAME=Android`,
    `-DCMAKE_SYSTEM_VERSION=23`,
    `-DDISABLE_TOR=TRUE`,
    `-DOPENSSL_CRYPTO_LIBRARY=${join(sslPath, arch, 'lib/libcrypto.a')}`,
    `-DOPENSSL_INCLUDE_DIR=${join(sslPath, 'include')}`,
    `-DOPENSSL_SSL_LIBRARY=${join(sslPath, arch, 'lib/libssl.a')}`
  ])
  await loudExec('cmake', [
    '--build',
    join(working, 'cmake'),
    '--config',
    'Release',
    '--target',
    'install',
    '--',
    `-j${cpus().length}`
  ])

  // Build the library:
  const cxxPath = join(
    ndkPath,
    `toolchains/llvm/prebuilt/darwin-x86_64/bin/${triple}-clang++`
  )
  const outPath = join(tmpPath, '../android/src/main/jniLibs/', arch)
  await mkdir(outPath, { recursive: true })
  const jniSources = [...sources, 'jni/jni.cpp']
  const sslLibs = ['crypto', 'ssl']

  console.log(`Linking librnzano.so for Android ${arch}`)
  await loudExec(cxxPath, [
    '-shared',
    '-fPIC',
    `-o${join(outPath, 'librnzano.so')}`,
    ...includePaths.map(path => `-I${join(tmpPath, path)}`),
    ...jniSources.map(source => join(srcPath, source)),
    ...boostLibs.map(name => join(boostPath, `/lib/libboost_${name}.a`)),
    ...sslLibs.map(name => join(sslPath, `${arch}/lib/lib${name}.a`)),
    ...zanoLibs.map(name => join(zanoLibPath, `lib${name}.a`)),
    '-llog',
    `-Wl,--version-script=${join(srcPath, 'jni/exports.map')}`,
    '-Wl,--no-undefined',
    '-Wl,-z,max-page-size=16384'
  ])
}

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
 * Locates the slice of a prebuilt xcframework that matches one platform.
 *
 * An xcframework declares its own slices in `Info.plist`, so ask it rather
 * than hardcoding directory names: a repackaged upstream framework then
 * fails here with a clear message instead of further down with a missing
 * file.
 *
 * The returned archive is checked against the architecture we are building.
 * The simulator slice holds both architectures in one archive, so the slice
 * alone does not pin the arch -- only the `-arch` flag on the relocatable
 * link below does, and Apple's `ld` tends to warn rather than fail when an
 * archive member does not match it. This also catches an unfetched Git LFS
 * pointer sitting where the 150MB archive should be, which otherwise shows
 * up as a confusing link error.
 */
async function findXcframeworkSlice(
  frameworkPath: string,
  platform: IosPlatform
): Promise<{ headersPath: string; libraryPath: string }> {
  const { arch, sdk } = platform
  const variant = sdk === 'iphonesimulator' ? 'simulator' : undefined

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
      library.SupportedPlatform === 'ios' &&
      library.SupportedPlatformVariant === variant &&
      library.SupportedArchitectures.includes(arch)
  )
  if (slice == null) {
    throw new Error(
      `${frameworkPath} has no ios${
        variant == null ? '' : `-${variant}`
      } slice for ${arch}. It offers: ${plist.AvailableLibraries.map(
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

/**
 * Compiles our wrapper and links it against the prebuilt
 * libzano-plain-wallet static library (which already bundles Zano,
 * Boost, and OpenSSL), then localizes symbols into a static lib.
 *
 * As of zano_native_lib HF6, the repo no longer ships the raw
 * `_libs_ios` OpenSSL/Boost archives we used to build Zano from
 * source against. Instead it provides prebuilt xcframeworks, so we
 * link the plain-wallet bundle directly.
 */
async function buildIosZano(platform: IosPlatform): Promise<void> {
  const { sdk, arch } = platform
  const working = join(tmpPath, `${sdk}-${arch}`)
  await mkdir(working, { recursive: true })

  // The prebuilt plain-wallet xcframework slice for this platform:
  const { headersPath, libraryPath: zanoLib } = await findXcframeworkSlice(
    join(
      tmpPath,
      'zano_native_lib/_install_ios/lib/libzano-plain-wallet.xcframework'
    ),
    platform
  )

  // Find platform tools:
  const ar = await quietExec('xcrun', ['--sdk', sdk, '--find', 'ar'])
  const cc = await quietExec('xcrun', ['--sdk', sdk, '--find', 'clang'])
  const cxx = await quietExec('xcrun', ['--sdk', sdk, '--find', 'clang++'])
  const ld = await quietExec('xcrun', ['--sdk', sdk, '--find', 'ld'])
  const objcopy = await getObjcopyPath()
  const sdkFlags = [
    '-arch',
    arch,
    '-target',
    iosSdkTriples[sdk].replace('%arch%', arch),
    '-isysroot',
    await quietExec('xcrun', ['--sdk', sdk, '--show-sdk-path'])
  ]
  const cflags = [
    `-I${headersPath}`,
    '-miphoneos-version-min=13.0',
    '-O2',
    '-Werror=partial-availability'
  ]
  const cxxflags = [...cflags, '-std=c++11']

  // Compile our sources:
  const objects: string[] = []
  for (const source of sources) {
    console.log(`Compiling ${source} for ${sdk}-${arch}...`)

    // Figure out the object file name:
    const object = join(
      working,
      source.replace(/^.*\//, '').replace(/\.c$|\.cc$|\.cpp$/, '.o')
    )
    objects.push(object)

    const useCxx = /\.cpp$|\.cc$/.test(source)
    await loudExec(useCxx ? cxx : cc, [
      '-c',
      ...(useCxx ? cxxflags : cflags),
      ...sdkFlags,
      `-o${object}`,
      join(srcPath, source)
    ])
  }

  // Link our wrapper against the prebuilt plain-wallet library
  // into a single relocatable object. `ld -r` pulls in only the
  // archive members our wrapper transitively needs:
  console.log(`Linking zano-module.o for ${sdk} ${arch}`)
  const objectPath = join(working, 'zano-module.o')
  await loudExec(ld, [
    '-r',
    '-arch',
    arch,
    '-o',
    objectPath,
    ...objects,
    zanoLib
  ])

  // Localize all symbols except the ones we really want,
  // hiding them from future linking steps:
  await loudExec(objcopy, [
    objectPath,
    '-w',
    '-L*',
    '-L!_zanoMethods',
    '-L!_zanoMethodCount'
  ])

  // Generate a static library:
  console.log(`Building static library for ${sdk}-${arch}...`)
  const library = join(working, `libzano-module.a`)
  await rm(library, { force: true })
  await loudExec(ar, ['rcs', library, objectPath])
}

/**
 * Creates a unified xcframework file out of the per-platform
 * static libraries that `buildIosZano` creates.
 */
async function packageIosZano(): Promise<void> {
  const sdks = new Set(iosPlatforms.map(row => row.sdk))

  // Merge the platforms into a fat library:
  const merged: string[] = []
  for (const sdk of sdks) {
    console.log(`Merging libraries for ${sdk}...`)
    const outPath = join(tmpPath, `${sdk}-lipo`)
    await mkdir(outPath, { recursive: true })
    const output = join(outPath, 'libzano-module.a')

    await loudExec('lipo', [
      '-create',
      '-output',
      output,
      ...iosPlatforms
        .filter(platform => platform.sdk === sdk)
        .map(({ sdk, arch }) =>
          join(tmpPath, `${sdk}-${arch}`, `libzano-module.a`)
        )
    ])
    merged.push('-library', output)
  }

  // Bundle those into an XCFramework:
  console.log('Creating XCFramework...')
  await rm('ios/ZanoModule.xcframework', { recursive: true, force: true })
  await loudExec('xcodebuild', [
    '-create-xcframework',
    ...merged,
    '-output',
    join(__dirname, '../ios/ZanoModule.xcframework')
  ])
}

main().catch(error => console.log(error))
