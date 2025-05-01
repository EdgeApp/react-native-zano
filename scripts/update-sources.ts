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

import { mkdir, readdir, rm } from 'fs/promises'
import { cpus } from 'os'
import { join } from 'path'

import { getNdkPath } from './utils/android-tools'
import {
  fileExists,
  getRepo,
  loudExec,
  quietExec,
  tmpPath
} from './utils/common'

export const srcPath = join(__dirname, '../src')

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
    '391a965d1d609f917cc97908b9d354a7f54e0258'
  )
  await getRepo(
    'Boost-for-Android',
    'https://github.com/moritz-wundke/Boost-for-Android.git',
    '51924ec5533a4fefb5edf99feaeded794c06a4fb'
  )
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
    '-Wl,--no-undefined'
  ])
}

/**
 * Invokes CMake to build Zano, then breaks open the resulting .a files
 * and re-assembles them into one giant .a file.
 */
async function buildIosZano(platform: IosPlatform): Promise<void> {
  const { sdk, arch, cmakePlatform } = platform
  const working = join(tmpPath, `${sdk}-${arch}`)
  await mkdir(working, { recursive: true })

  // Find platform tools:
  const ar = await quietExec('xcrun', ['--sdk', sdk, '--find', 'ar'])
  const cc = await quietExec('xcrun', ['--sdk', sdk, '--find', 'clang'])
  const cxx = await quietExec('xcrun', ['--sdk', sdk, '--find', 'clang++'])
  const sdkFlags = [
    '-arch',
    arch,
    '-target',
    iosSdkTriples[sdk].replace('%arch%', arch),
    '-isysroot',
    await quietExec('xcrun', ['--sdk', sdk, '--show-sdk-path'])
  ]
  const cflags = [
    ...includePaths.map(path => `-I${join(tmpPath, path)}`),
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

  // Build Zano itself:
  const boostPath = join(tmpPath, `zano_native_lib/_libs_ios/boost`)
  const sslPath = join(tmpPath, `zano_native_lib/_libs_ios/OpenSSL/${sdk}`)
  const iosToolchain = join(
    tmpPath,
    'zano_native_lib/ios-cmake/ios.toolchain.cmake'
  )
  await loudExec('cmake', [
    // Source directory:
    `-S${join(tmpPath, 'zano_native_lib/Zano')}`,
    // Build directory:
    `-B${join(working, 'cmake')}`,
    // Build options:
    `-DBoost_INCLUDE_DIRS=${join(boostPath, 'include')}`,
    `-DBoost_LIBRARY_DIRS=${join(boostPath, `stage/${sdk}/${arch}`)}`,
    `-DBoost_VERSION="1.84.0"`,
    `-DCMAKE_BUILD_TYPE=Release`,
    `-DCMAKE_INSTALL_PREFIX=${working}`,
    `-DCMAKE_SYSTEM_NAME=iOS`,
    `-DCMAKE_TOOLCHAIN_FILE=${iosToolchain}`,
    `-DCMAKE_XCODE_ATTRIBUTE_ONLY_ACTIVE_ARCH=NO`,
    `-DDISABLE_TOR=TRUE`,
    `-DOPENSSL_CRYPTO_LIBRARY=${join(sslPath, 'lib/libcrypto.a')}`,
    `-DOPENSSL_INCLUDE_DIR=${join(sslPath, 'include')}`,
    `-DOPENSSL_SSL_LIBRARY=${join(sslPath, 'lib/libssl.a')}`,
    `-DPLATFORM=${cmakePlatform}`,
    `-GXcode`
  ])
  await loudExec('cmake', [
    '--build',
    join(working, 'cmake'),
    '--config',
    'Release',
    '--target',
    'install'
  ])

  // Explode Zano archives and gather the objects:
  async function unpackLib(libPath: string, name: string): Promise<void> {
    console.log(`Unpacking lib${name}.a`)
    const outPath = join(working, `unpack/${name}`)
    await rm(outPath, { recursive: true, force: true })
    await mkdir(outPath, { recursive: true })
    await loudExec('ar', ['-x', libPath], { cwd: outPath })

    // Add object files to the list:
    for (const file of await readdir(outPath)) {
      if (file.endsWith('.o')) objects.push(join(outPath, file))
    }
  }
  for (const lib of zanoLibs) {
    await unpackLib(join(working, `lib/lib${lib}.a`), lib)
  }
  for (const lib of boostLibs) {
    await unpackLib(
      join(
        tmpPath,
        `zano_native_lib/_libs_ios/boost/stage/${sdk}/${arch}/libboost_${lib}.a`
      ),
      `boost_${lib}`
    )
  }

  // Generate a static library:
  console.log(`Building static library for ${sdk}-${arch}...`)
  const library = join(working, `libzano-module.a`)
  await rm(library, { force: true })
  await loudExec(ar, ['rcs', library, ...objects])
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
