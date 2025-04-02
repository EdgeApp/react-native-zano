// Run this script as `node -r sucrase/register ./scripts/update-sources.ts`
//
// It will:
// - Download third-party source code.
// - Assemble an iOS universal static library.
//
// This library only uses about 1500 of the 13000 boost headers files,
// so we ask the C compiler which headers are actually useful.

import { execSync } from 'child_process'
import { makeNodeDisklet } from 'disklet'
import { existsSync, mkdirSync, unlinkSync } from 'fs'
import { mkdir, readdir, rm } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'

const disklet = makeNodeDisklet(join(__dirname, '../'))
const execFile = promisify(require('child_process').execFile)
const tmp = join(__dirname, '../tmp')

async function main(): Promise<void> {
  if (!existsSync(tmp)) mkdirSync(tmp)
  await downloadSources()
  await runZanoScripts()
  await generateIosLibrary()
}

async function downloadSources(): Promise<void> {
  getRepo(
    'zano_native_lib',
    'https://github.com/hyle-team/zano_native_lib.git',
    '391a965d1d609f917cc97908b9d354a7f54e0258'
  )
  await copyFiles('src/', 'tmp/', [
    'zano-wrapper/zano-methods.cpp',
    'zano-wrapper/zano-methods.hpp'
  ])
}

// Preprocessor definitions:
const defines: string[] = []

// Compiler options:
const includePaths: string[] = [
  'zano_native_lib/Zano/src/wallet'
]

// Source list:
const sources: string[] = ['zano-wrapper/zano-methods.cpp']

// Stuff the Zano scripts produce:
const zanoArchives = [
  `libcommon`,
  `libcrypto_`,
  `libcurrency_core`,
  `libwallet`,
  `libz`
]

// Phones and simulators we need to support:
const iosPlatforms: Array<{ sdk: string; arch: string; zanoLib: string }> = [
  { sdk: 'iphoneos', arch: 'arm64', zanoLib: 'arm64' },
  { sdk: 'iphonesimulator', arch: 'arm64', zanoLib: 'arm64_simulator' },
  { sdk: 'iphonesimulator', arch: 'x86_64', zanoLib: 'x86_64' }

  // Zano does not support these:
  // { sdk: 'iphoneos', arch: 'armv7' },
  // { sdk: 'iphoneos', arch: 'armv7s' },
]
const iosSdkTriples: { [sdk: string]: string } = {
  iphoneos: '%arch%-apple-ios9.0',
  iphonesimulator: '%arch%-apple-ios9.0-simulator'
}

/**
 * Run the upstream Zano build scripts.
 */
async function runZanoScripts(): Promise<void> {
  try {
    execSync('./build_ios_libs.sh', {
      cwd: join(tmp, 'zano_native_lib'),
      stdio: 'inherit',
      encoding: 'utf8'
    })
  } catch (error) {
    // We expect the script to fail,
    // but there isn't a unique error message we can look for
  }
}

/**
 * Compiles the sources into an iOS static library.
 */
async function generateIosLibrary(): Promise<void> {
  const cflags = [
    ...defines.map(name => `-D${name}`),
    ...includePaths.map(path => `-I${join(tmp, path)}`),
    '-miphoneos-version-min=9.0',
    '-O2',
    '-Werror=partial-availability'
  ]
  const cxxflags = [...cflags, '-std=c++11']

  // Generate a library for each platform:
  const libraries: string[] = []
  for (const { sdk, arch, zanoLib } of iosPlatforms) {
    const working = join(tmp, `${sdk}-${arch}`)
    if (!existsSync(working)) mkdirSync(working)

    // Find platform tools:
    const xcrun = ['xcrun', '--sdk', sdk]
    const ar = quietExec([...xcrun, '--find', 'ar'])
    const cc = quietExec([...xcrun, '--find', 'clang'])
    const cxx = quietExec([...xcrun, '--find', 'clang++'])
    const sdkFlags = [
      '-arch',
      arch,
      '-target',
      iosSdkTriples[sdk].replace('%arch%', arch),
      '-isysroot',
      quietExec([...xcrun, '--show-sdk-path'])
    ]

    // Compile sources:
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
      quietExec([
        useCxx ? cxx : cc,
        '-c',
        ...(useCxx ? cxxflags : cflags),
        ...sdkFlags,
        `-o ${object}`,
        join(tmp, source)
      ])
    }

    // Explode Zano archives and gather the objects:
    for (const archive of zanoArchives) {
      const arPath = join(
        tmp,
        `zano_native_lib/_install_ios/${zanoLib}/lib/${archive}.a`
      )
      const cwd = join(working, archive)
      await rm(cwd, { recursive: true, force: true })
      await mkdir(cwd, { recursive: true })
      await execFile('ar', ['-x', arPath], { cwd })

      // Add object files to the list:
      for (const file of await readdir(cwd)) {
        if (file.endsWith('.o')) objects.push(join(cwd, file))
      }
    }

    // Add the boost objects:
    const boostPath = join(
      tmp,
      `zano_native_lib/_libs_ios/boost/stage/${sdk}/${arch}/obj`
    )
    for (const entry of await readdir(boostPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const dir = join(boostPath, entry.name)
        for (const file of await readdir(dir)) {
          if (file.endsWith('.o')) objects.push(join(dir, file))
        }
      }
    }

    // Generate a static library:
    console.log(`Building static library for ${sdk}-${arch}...`)
    const library = join(working, `libzano-module.a`)
    if (existsSync(library)) unlinkSync(library)
    libraries.push(library)
    quietExec([ar, 'rcs', library, ...objects])
  }

  // Merge the platforms into a fat library:
  const merged: string[] = []
  const sdks = new Set(iosPlatforms.map(row => row.sdk))
  for (const sdk of sdks) {
    console.log(`Merging libraries for ${sdk}...`)
    const working = join(tmp, `${sdk}-lipo`)
    if (!existsSync(working)) mkdirSync(working)
    const output = join(working, 'libzano-module.a')
    merged.push('-library', output)
    quietExec([
      'lipo',
      '-create',
      '-output',
      output,
      ...libraries.filter((_, i) => iosPlatforms[i].sdk === sdk)
    ])
  }

  // Bundle those into an XCFramework:
  console.log('Creating XCFramework...')
  await disklet.delete('ios/ZanoModule.xcframework')
  quietExec([
    'xcodebuild',
    '-create-xcframework',
    ...merged,
    '-output',
    join(__dirname, '../ios/ZanoModule.xcframework')
  ])
}

/**
 * Clones a git repo and checks our a hash.
 */
function getRepo(name: string, uri: string, hash: string): void {
  const path = join(tmp, name)

  // Clone (if needed):
  if (!existsSync(path)) {
    console.log(`Cloning ${name}...`)
    loudExec(['git', 'clone', uri, name])
  }

  // Checkout:
  console.log(`Checking out ${name}...`)
  execSync(`git checkout -f ${hash}`, {
    cwd: path,
    stdio: 'inherit',
    encoding: 'utf8'
  })

  // Checkout submodules:
  execSync(`git submodule update --init --recursive`, {
    cwd: path,
    stdio: 'inherit',
    encoding: 'utf8'
  })
}

/**
 * Downloads & unpacks a zip file.
 */
function getZip(name: string, uri: string): void {
  const path = join(tmp, name)

  if (!existsSync(path)) {
    console.log(`Getting ${name}...`)
    loudExec(['curl', '-L', '-o', path, uri])
  }

  // Unzip:
  loudExec(['unzip', '-u', path])
}

/**
 * Copies just the files we need from one folder to another.
 */
async function copyFiles(
  from: string,
  to: string,
  files: string[]
): Promise<void> {
  for (const file of files) {
    await disklet.setText(to + file, await disklet.getText(from + file))
  }
}

/**
 * Runs a command and returns its results.
 */
function quietExec(argv: string[]): string {
  return execSync(argv.join(' '), {
    cwd: tmp,
    encoding: 'utf8'
  }).replace(/\n$/, '')
}

/**
 * Runs a command and displays its results.
 */
function loudExec(argv: string[]): void {
  execSync(argv.join(' '), {
    cwd: tmp,
    stdio: 'inherit',
    encoding: 'utf8'
  })
}

main().catch(error => console.log(error))
