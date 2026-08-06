import { execSync, spawn } from 'child_process'
import { access, mkdir } from 'fs/promises'
import { join } from 'path'

export const tmpPath = join(__dirname, '../../tmp')

/**
 * Fetches a git repo and checks out a hash.
 *
 * We fetch just the pinned commit rather than cloning the whole history.
 * Some of these repos keep large prebuilt binaries in Git LFS, so a plain
 * clone drags down every historical revision of those - slow, and prone to
 * dying partway through on a flaky connection.
 *
 * Pass `lfsIncludes` for LFS repos to grab only the paths we build against,
 * skipping the platforms we never touch.
 */
export async function getRepo(
  name: string,
  uri: string,
  hash: string,
  opts: { lfsIncludes?: string[] } = {}
): Promise<void> {
  const { lfsIncludes } = opts
  const path = join(tmpPath, name)

  // Set up the repo (if needed):
  if (!(await fileExists(path))) {
    console.log(`Creating ${name}...`)
    await mkdir(path, { recursive: true })
    await loudExec('git', ['init', '-q'], { cwd: path })
    await loudExec('git', ['remote', 'add', 'origin', uri], { cwd: path })
  }

  // Fetch the pinned commit, unless we already have it.
  // The check also picks up hash bumps on an existing checkout:
  if (!(await hasCommit(path, hash))) {
    console.log(`Fetching ${name}...`)
    try {
      await loudExec('git', ['fetch', '--depth', '1', 'origin', hash], {
        cwd: path
      })
    } catch (error) {
      // Not every server allows fetching a bare hash:
      await loudExec('git', ['fetch', 'origin'], { cwd: path })
    }
  }

  // Checkout. Skipping the LFS smudge filter keeps this from blocking on an
  // all-platforms LFS download; we pull the parts we need below:
  console.log(`Checking out ${name}...`)
  await loudExec('git', ['checkout', '-f', hash], {
    cwd: path,
    env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' }
  })

  // Grab the LFS objects we actually build against:
  if (lfsIncludes != null) {
    console.log(`Fetching ${name} LFS objects...`)
    await loudExec(
      'git',
      ['lfs', 'pull', `--include=${lfsIncludes.join(',')}`],
      { cwd: path }
    )
  }

  // Checkout submodules:
  await loudExec('git', ['submodule', 'update', '--init', '--recursive'], {
    cwd: path
  })
}

/**
 * Checks whether a repo already contains a particular commit.
 *
 * Uses `cat-file -e`, which consults the object database. `rev-parse
 * --verify` would accept any well-formed hash without checking that we
 * actually have it.
 */
async function hasCommit(path: string, hash: string): Promise<boolean> {
  try {
    await quietExec('git', ['cat-file', '-e', hash], { cwd: path })
    return true
  } catch (error) {
    return false
  }
}

/**
 * Downloads & unpacks a zip file.
 */
export async function getZip(name: string, uri: string): Promise<void> {
  const path = join(tmpPath, name)

  if (!(await fileExists(path))) {
    console.log(`Getting ${name}...`)
    await loudExec('curl', ['-L', '-o', path, uri])
  }

  // Unzip:
  await loudExec('unzip', ['-u', path])
}

export async function fileExists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false
  )
}

export async function loudExec(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<void> {
  const { cwd = tmpPath, env = process.env } = opts
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env
    })

    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} exited with code ${String(code)}`))
      }
    })
  })
}

/**
 * Runs a command and returns its results.
 */
export async function quietExec(
  command: string,
  args: string[],
  opts: { cwd?: string } = {}
): Promise<string> {
  const { cwd = tmpPath } = opts
  return execSync(command + ' ' + args.join(' '), {
    cwd,
    encoding: 'utf8'
  }).replace(/\n$/, '')
}
