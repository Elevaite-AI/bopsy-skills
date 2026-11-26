import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkPackage, findCatalog, loadCatalogIds, repoRoot, type CheckResult } from './check.js'
import { PackageError, readDir } from './files.js'
import { inspectPackage } from './package.js'
import { MANIFEST_FILE, readManifest } from './manifest.js'
import { buildTarget, isTarget, TARGETS } from './targets.js'
import { skillTemplate } from './templates.js'

/**
 * `bopsy-skill new | check | pack`: build a Bopsy skill package the way Bopsy checks it. In the Bopsy repo it's
 * `pnpm bopsy-skill` (not `pnpm skill`: outside the repo root that runs the system's `skill` command, which signals
 * processes).
 */

/** The package's README, at its root: one folder up from both src/ and dist/. */
export const readmePath = (): string => fileURLToPath(new URL('../README.md', import.meta.url))

export interface Io { cwd: string; out: (s: string) => void; err: (s: string) => void }

const USAGE = `Usage: bopsy-skill <command>   (npx @bopsy/skills <command>; pnpm bopsy-skill in the Bopsy repo)
  new <slug> [--dir <parent>]        start a package (in the current folder; packages/skills in the Bopsy repo)
  check [dir] [--catalog <file>]     check a package folder the way Bopsy does
  check --all                        check every package in packages/skills (Bopsy repo)
  pack [dir] [--out <path>] [--for <target>]
                                     check, then write the package's .zip, or for another platform:
                                     --for ${TARGETS.join(' | ')}
  guide                              print the guide to building a package (for people and models)`

// A package's first skill is named after it, so the slug follows the Agent Skills name rule.
const NEW_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

const FLAGS: Record<string, Record<string, 'value' | 'switch'>> = {
  new: { dir: 'value' },
  check: { catalog: 'value', all: 'switch' },
  pack: { catalog: 'value', out: 'value', for: 'value' },
  guide: {},
}

/** Positional arguments and the command's known flags; anything else is refused, never quietly skipped. */
function parseArgs(cmd: string, argv: string[]): { positional: string[]; flags: Map<string, string | true> } {
  const known = FLAGS[cmd] ?? {}
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { positional.push(a); continue }
    const name = a.slice(2)
    const kind = known[name]
    if (!kind) throw new PackageError(`${a} isn't an option of ${cmd}.\n${USAGE}`)
    if (kind === 'switch') { flags.set(name, true); continue }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new PackageError(`${a} needs a value.\n${USAGE}`)
    flags.set(name, value)
    i++
  }
  if (positional.length > 1) throw new PackageError(`One folder at a time: ${positional.join(' ')}.\n${USAGE}`)
  return { positional, flags }
}

function report(r: CheckResult, dir: string, io: Io): void {
  for (const p of r.problems) io.out(`${p.level} ${p.file ? `${p.file}${p.line ? `:${p.line}` : ''} ` : ''}${p.message}`)
  const errors = r.problems.filter((p) => p.level === 'error').length
  io.out(r.ok ? `✓ ${r.slug}${r.version ? ` ${r.version}` : ''}: ${r.skills} skill${r.skills === 1 ? '' : 's'}, ${r.files} files` : `✗ ${r.slug ?? basename(dir)}: ${errors} error${errors === 1 ? '' : 's'}`)
}

export async function main(argv: string[], io: Io): Promise<number> {
  const [cmd, ...rest] = argv
  if (!cmd || !FLAGS[cmd]) { io.err(USAGE); return 2 }
  const at = (p: string) => resolve(io.cwd, p)
  try {
    const { positional, flags } = parseArgs(cmd, rest)
    const str = (k: string) => (typeof flags.get(k) === 'string' ? (flags.get(k) as string) : undefined)
    if (cmd === 'guide') {
      io.out((await readFile(readmePath(), 'utf8')).trimEnd())
      return 0
    }

    if (cmd === 'new') {
      const slug = positional[0]
      if (!slug || !NEW_SLUG_RE.test(slug) || slug.length > 64) {
        io.err('Give the package a name of lowercase letters, digits and single hyphens, e.g. bopsy-skill new meta-ads-os.')
        return 2
      }
      // In the Bopsy repo, built-ins live in packages/skills; anywhere else, the folder the command was typed in.
      const root = repoRoot(io.cwd)
      const parent = str('dir') ? at(str('dir')!) : root ? join(root, 'packages', 'skills') : io.cwd
      const dir = join(parent, slug)
      if (existsSync(dir)) { io.err(`${dir} already exists.`); return 1 }
      for (const [path, text] of Object.entries(skillTemplate(slug))) {
        await mkdir(dirname(join(dir, path)), { recursive: true })
        await writeFile(join(dir, path), text)
      }
      io.out(`Made ${dir}`)
      io.out(`Next: fill in its SKILL.md and bopsy.json, then bopsy-skill check ${dir}`)
      return 0
    }

    if (cmd === 'check' || cmd === 'pack') {
      const target = str('for') ?? 'bopsy'
      if (!isTarget(target)) { io.err(`--for takes one of ${TARGETS.join(', ')}.`); return 2 }
      const catalog = findCatalog(io.cwd, str('catalog') ? at(str('catalog')!) : undefined)
      const catalogIds = catalog ? await loadCatalogIds(catalog) : null
      let dirs: string[]
      if (cmd === 'check' && flags.has('all')) {
        const root = repoRoot(io.cwd)
        const parent = root ? join(root, 'packages', 'skills') : null
        const names = parent && existsSync(parent) ? (await readdir(parent, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []
        if (!names.length) { io.out('No packages in packages/skills.'); return 0 }
        dirs = names.map((n) => join(parent!, n))
      } else dirs = [at(positional[0] ?? '.')]

      for (const dir of dirs) {
        if (!(await stat(dir).catch(() => null))?.isDirectory()) throw new PackageError(`${dir} isn't a folder.`)
      }
      let failed = false
      for (const dir of dirs) {
        const r = await checkPackage(dir, { catalogIds })
        report(r, dir, io)
        if (!r.ok) failed = true
      }
      if (failed) return 1
      if (cmd === 'check') return 0

      const { files } = await readDir(dirs[0])
      const info = inspectPackage(files, { fileName: basename(dirs[0]), root: '' })
      const manifest = files.find((f) => f.path === MANIFEST_FILE)
      const description = manifest ? readManifest(Buffer.from(manifest.bytes).toString('utf8')).manifest.description : undefined
      const { outputs, notes } = await buildTarget(target, files, { slug: info.slug, version: info.version, description, skills: info.skills })
      for (const n of notes) io.out(`note ${n}`)
      // Next to the package, never inside it, so the next pack doesn't ship this output.
      // Folders are made only inside a target's own output folder; a --out into a missing folder is an error.
      const write = async (path: string, bytes: Uint8Array, makeDirs: boolean, exec = false) => {
        try {
          if (makeDirs) await mkdir(dirname(path), { recursive: true })
          await writeFile(path, bytes, { mode: exec ? 0o755 : 0o644 })
        } catch (err) {
          throw new PackageError(`Couldn't write ${path}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`)
        }
      }
      if (target === 'bopsy') {
        const out = str('out') ? at(str('out')!) : join(dirname(dirs[0]), outputs[0].path)
        await write(out, outputs[0].bytes, false)
        io.out(`Wrote ${out}`)
        return 0
      }
      const outDir = str('out') ? at(str('out')!) : join(dirname(dirs[0]), `${info.slug}-${target}`)
      if (existsSync(outDir)) { io.err(`${outDir} already exists: remove it or pass --out.`); return 1 }
      for (const o of outputs) await write(join(outDir, o.path), o.bytes, true, o.exec === true)
      io.out(`Wrote ${outDir}`)
      return 0
    }
  } catch (err) {
    if (err instanceof PackageError) { io.err(err.message); return 2 }
    throw err
  }
  return 2
}

/**
 * Runs the CLI on this process's arguments, in `cwd`, and sets its exit code. The installed bin passes its own working
 * folder; `pnpm bopsy-skill` in the repo passes INIT_CWD, since pnpm runs root scripts from the repo root.
 */
export function run(cwd: string): void {
  main(process.argv.slice(2), { cwd, out: (s) => console.log(s), err: (s) => console.error(s) })
    .then((code) => { process.exitCode = code }, (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exitCode = 2
    })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run(process.env.INIT_CWD ?? process.cwd())
