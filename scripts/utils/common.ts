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

  // Set up the repo. Both steps are idempotent and run every time rather
  // than behind a `fileExists(path)` check: a run killed between the mkdir
  // and the init used to leave a directory that looked set up but had no
  // `.git` and no remote, which every later run then skipped and no fetch
  // could recover from.
  if (!(await fileExists(join(path, '.git'))))
    console.log(`Creating ${name}...`)
  await mkdir(path, { recursive: true })
  await loudExec('git', ['init', '-q'], { cwd: path })
  if (!(await tryExec('git', ['remote', 'set-url', 'origin', uri], path))) {
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
      // Not every server allows fetching a bare hash. Revoked access, a
      // dropped connection and a force-pushed-away commit land here too, and
      // if the full fetch succeeds without bringing the hash along, the
      // checkout below fails on an unrelated-looking "unknown revision" --
      // so say what actually went wrong first:
      console.log(
        `Could not fetch ${hash} directly, retrying with a full fetch: ${String(
          error
        )}`
      )

      // A plain `fetch` on a repo an earlier run left shallow keeps it
      // shallow, which brings down the branch tips and not the pinned commit
      // behind them. `--unshallow` is only valid on a shallow repo, so pick
      // by whether git left its marker:
      const shallow = await fileExists(join(path, '.git', 'shallow'))
      await loudExec(
        'git',
        shallow ? ['fetch', '--unshallow', 'origin'] : ['fetch', 'origin'],
        { cwd: path }
      )
    }

    // Fail here rather than at the checkout, which reports a missing pin as
    // an opaque "unknown revision" with the fetch error already gone:
    if (!(await hasCommit(path, hash))) {
      throw new Error(`Could not fetch ${hash} for ${name} from ${uri}`)
    }
  }

  // Checkout. Skipping the LFS smudge filter keeps this from blocking on an
  // all-platforms LFS download; we pull the parts we need below:
  console.log(`Checking out ${name}...`)
  await loudExec('git', ['checkout', '-f', hash], {
    cwd: path,
    env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' }
  })

  // Grab the LFS objects we actually build against. The empty `--exclude` is
  // load-bearing: `--include` overrides `lfs.fetchinclude` but leaves any
  // configured `lfs.fetchexclude` in force, so on a machine with a global
  // exclude the pull reports success while leaving pointer files in place,
  // and the build then links against 4KB of ASCII.
  if (lfsIncludes != null) {
    console.log(`Fetching ${name} LFS objects...`)
    await loudExec(
      'git',
      ['lfs', 'pull', `--include=${lfsIncludes.join(',')}`, '--exclude='],
      { cwd: path }
    )
  }

  // Checkout submodules. `--force` because `update-sources` patches
  // `RIPEMD160.h`, which lives inside the Zano submodule: without it the
  // second run of this script aborts on "local changes would be overwritten"
  // and the build is not repeatable, which `prepack` needs it to be.
  await loudExec(
    'git',
    ['submodule', 'update', '--init', '--recursive', '--force'],
    { cwd: path }
  )
}

/**
 * Checks whether a repo already contains a particular commit, and everything
 * that commit points at.
 *
 * `rev-parse --verify` would accept any well-formed hash without checking
 * that we have it, and `cat-file -e <hash>` proves only that the commit
 * object arrived. Below `fetch.unpackLimit` git writes loose objects in no
 * particular order, so a run killed mid-unpack can leave the commit present
 * with its tree missing -- which this check would wave through, skipping the
 * fetch that would repair it. `rev-list --objects` walks the whole thing.
 */
async function hasCommit(path: string, hash: string): Promise<boolean> {
  return await tryExec(
    'git',
    ['rev-list', '--objects', '--quiet', hash, '--'],
    path
  )
}

/**
 * Runs a command, reporting whether it succeeded rather than throwing, and
 * without inheriting stdio -- for the cases where a failure is an expected
 * answer instead of an error.
 */
async function tryExec(
  command: string,
  args: string[],
  cwd: string
): Promise<boolean> {
  return await new Promise(resolve => {
    const child = spawn(command, args, { cwd, stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('exit', code => resolve(code === 0))
  })
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
 * Runs a command and returns its stdout, without going through a shell.
 */
export async function captureExec(
  command: string,
  args: string[],
  opts: { cwd?: string } = {}
): Promise<string> {
  const { cwd = tmpPath } = opts
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'inherit']
    })

    let out = ''
    child.stdout.on('data', chunk => {
      out += String(chunk)
    })

    child.on('error', reject)
    // `close` rather than `exit`: the process can exit while stdout still has
    // buffered data, which would truncate the output we are here to collect.
    // `close` waits for the stdio streams too.
    child.on('close', code => {
      if (code === 0) resolve(out.replace(/\n$/, ''))
      else reject(new Error(`${command} exited with code ${String(code)}`))
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
