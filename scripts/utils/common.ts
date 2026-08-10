import { execSync, spawn } from 'child_process'
import { access } from 'fs/promises'
import { join } from 'path'

export const tmpPath = join(__dirname, '../../tmp')

/**
 * Clones a git repo and checks our a hash.
 */
export async function getRepo(
  name: string,
  uri: string,
  hash: string
): Promise<void> {
  const path = join(tmpPath, name)

  // Clone (if needed):
  if (!(await fileExists(path))) {
    console.log(`Cloning ${name}...`)
    await loudExec('git', ['clone', uri, name])
  }

  // Checkout:
  console.log(`Checking out ${name}...`)
  await loudExec('git', ['checkout', '-f', hash], { cwd: path })

  // Checkout submodules:
  await loudExec('git', ['submodule', 'update', '--init', '--recursive'], {
    cwd: path
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
  opts: { cwd?: string } = {}
): Promise<void> {
  const { cwd = tmpPath } = opts
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: process.env
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
