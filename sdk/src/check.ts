import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { MAX_ZIP_BYTES, PackageError, readDir, type SourceFile } from './files.js'
import { MANIFEST_FILE, parseManifest, readManifest, type Problem } from './manifest.js'
import { inspectPackage } from './package.js'
import { packFiles } from './pack.js'
import { staticScan, toPackageFiles } from './scan.js'

/**
 * Checks a package folder the way Bopsy checks an upload, plus the stricter bopsy.json rules: what `pnpm bopsy-skill check`
 * runs before anything is uploaded or merged.
 */

export interface CheckResult {
  slug: string | null
  version: string | null
  skills: number
  files: number
  problems: Problem[]
  ok: boolean
}

/** The repo's Integrations catalog, relative to its root: also how a pnpm workspace is known to be Bopsy's own. */
const CATALOG_IN_REPO = ['apps', 'server', 'src', 'lib', 'mcp-catalog.json']

/**
 * The Bopsy repo `from` is in: the nearest folder up with pnpm-workspace.yaml, when it holds Bopsy's catalog; null
 * outside it, including in anyone else's pnpm workspace.
 */
export function repoRoot(from: string): string | null {
  for (let d = resolve(from); ; d = dirname(d)) {
    if (existsSync(join(d, 'pnpm-workspace.yaml'))) return existsSync(join(d, ...CATALOG_IN_REPO)) ? d : null
    if (dirname(d) === d) return null
  }
}

/**
 * The Integrations catalog to check needs against: the one given, else the repo's (the server's list of apps a
 * workspace can connect), else null outside the repo, where needs are checked against NEEDS alone.
 */
export function findCatalog(cwd: string, given?: string): string | null {
  if (given) return given
  const root = repoRoot(cwd)
  return root ? join(root, ...CATALOG_IN_REPO) : null
}

export async function loadCatalogIds(path: string): Promise<Set<string>> {
  let text: string
  try { text = await readFile(path, 'utf8') } catch {
    throw new PackageError(`Can't find the Integrations catalog at ${path}; pass --catalog <file>.`)
  }
  let apps: unknown
  try { apps = (JSON.parse(text) as { apps?: unknown }).apps } catch { apps = undefined }
  if (!Array.isArray(apps)) throw new PackageError(`${path} isn't an Integrations catalog (no "apps" list); pass --catalog <file>.`)
  return new Set(apps.map((a) => (a as { id?: unknown })?.id).filter((id): id is string => typeof id === 'string'))
}

export async function checkPackage(dir: string, opts: { catalogIds: ReadonlySet<string> | null }): Promise<CheckResult> {
  const root = resolve(dir)
  const problems: Problem[] = []
  const done = (r: Omit<CheckResult, 'problems' | 'ok'>): CheckResult => ({ ...r, problems, ok: !problems.some((p) => p.level === 'error') })

  let files: SourceFile[] = []
  let info: ReturnType<typeof inspectPackage>
  try {
    files = (await readDir(root)).files
    info = inspectPackage(files, { fileName: basename(root), root: '' })
  } catch (err) {
    if (!(err instanceof PackageError)) throw err
    problems.push({ level: 'error', file: '', line: null, message: err.message })
    return done({ slug: null, version: null, skills: 0, files: files.length })
  }

  const manifest = files.find((f) => f.path === MANIFEST_FILE)
  // inspectPackage repeats the upload reader's bopsy.json notes; they're reported below with the catalog instead.
  const uploadNotes = new Set(manifest ? parseManifest(Buffer.from(manifest.bytes).toString('utf8')).warnings : [])
  if (!manifest) {
    problems.push({ level: 'warning', file: '', line: null, message: `No ${MANIFEST_FILE}: add one to declare what the package needs (bopsy-skill new shows the layout).` })
  } else {
    problems.push(...readManifest(Buffer.from(manifest.bytes).toString('utf8'), { strict: true, ...(opts.catalogIds ? { catalogIds: opts.catalogIds } : {}) }).problems)
  }

  // A local secrets file would go to the library and onto every agent's computer. An example file is fine.
  for (const f of files) {
    const name = f.path.split('/').pop()!
    if (/^\.env(\..+)?$/.test(name) && name !== '.env.example') {
      problems.push({ level: 'error', file: f.path, line: null, message: "Looks like local secrets: remove it. Declare the settings in bopsy.json instead; a connection's token never goes in a package." })
    }
  }
  // The same limit the upload applies to the packed ZIP.
  if ((await packFiles(files)).length > MAX_ZIP_BYTES) {
    problems.push({ level: 'error', file: '', line: null, message: `The package is too big (at most ${MAX_ZIP_BYTES / 1024 / 1024} MB).` })
  }
  for (const f of staticScan(toPackageFiles(files)).findings) {
    if (f.severity !== 'high' && f.severity !== 'medium') continue
    problems.push({ level: f.severity === 'high' ? 'error' : 'warning', file: f.file, line: f.line, message: `[${f.rule}] ${f.message}` })
  }
  for (const w of info.warnings) if (!uploadNotes.has(w)) problems.push({ level: 'warning', file: '', line: null, message: w })

  return done({ slug: info.slug, version: info.version, skills: info.skills.length, files: files.length })
}
