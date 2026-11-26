import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'

/**
 * Reading a skill package's files: from an uploaded ZIP (the server) or a folder (the CLI). Every path is checked
 * before anything is unpacked, and the same size and file limits apply either way.
 */

export const MAX_ZIP_BYTES = 10 * 1024 * 1024
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024
export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_FILES = 2000
export const MAX_SKILLS = 60
const MAX_PATH = 300

export class PackageError extends Error {}

/** One file of a package, at its path under the package root. */
export interface SourceFile { path: string; bytes: Uint8Array; exec: boolean }

const JUNK = (path: string) =>
  path.startsWith('__MACOSX/') || path.split('/').some((p) => p === '.DS_Store' || p === 'Thumbs.db' || p === '.git')

/** A package path we can put on disk as is: relative, no `..`, no empty or dot segments, nothing odd. */
export function checkPath(raw: string): string {
  const path = raw.replace(/\/+$/, '')
  if (!path || path.length > MAX_PATH) throw new PackageError(`A file path is empty or too long: ${raw.slice(0, 80)}`)
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(path) || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    throw new PackageError(`The package has a file path we can't use: ${raw.slice(0, 80)}`)
  }
  for (const seg of path.split('/')) {
    if (!seg || seg === '.' || seg === '..') throw new PackageError(`The package has a file path we can't use: ${raw.slice(0, 80)}`)
  }
  return path
}

/** jszip keeps the declared size before it inflates anything; used to refuse a ZIP bomb up front. */
const declaredSize = (f: JSZip.JSZipObject): number | null => {
  const n = (f as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

const S_IFMT = 0o170000
const S_IFLNK = 0o120000
const isSymlink = (f: JSZip.JSZipObject) => typeof f.unixPermissions === 'number' && (f.unixPermissions & S_IFMT) === S_IFLNK
const isExecutable = (path: string, f: JSZip.JSZipObject) =>
  /\.(sh|py)$/.test(path) || (typeof f.unixPermissions === 'number' && (f.unixPermissions & 0o100) !== 0)

export const TOO_BIG = `The package unpacks too big (at most ${MAX_TOTAL_BYTES / 1024 / 1024} MB, ${MAX_FILE_BYTES / 1024 / 1024} MB a file).`
export const TOO_MANY = `The package has too many files (at most ${MAX_FILES}).`

/** Two paths that differ only in case would land on one file on some computers. */
export function checkUnique(files: SourceFile[]): void {
  const seen = new Set<string>()
  for (const f of files) {
    const key = f.path.toLowerCase()
    if (seen.has(key)) throw new PackageError(`The package has two files at ${f.path}.`)
    seen.add(key)
  }
}

/**
 * The files of an uploaded ZIP, checked. One top-level folder holding everything (a zipped folder) is the package's
 * root and comes off each path; `root` is that folder with a trailing `/`, or ''.
 */
export async function readZip(data: Buffer): Promise<{ files: SourceFile[]; root: string }> {
  if (data.length === 0) throw new PackageError('The file is empty.')
  if (data.length > MAX_ZIP_BYTES) throw new PackageError(`The package is too big (at most ${MAX_ZIP_BYTES / 1024 / 1024} MB).`)
  let zip: JSZip
  try { zip = await JSZip.loadAsync(data) } catch { throw new PackageError("That isn't a ZIP file we can read.") }

  // jszip rewrites `../` out of names as it reads; a package that tries it is refused, not quietly fixed.
  for (const f of Object.values(zip.files)) {
    const original = (f as unknown as { unsafeOriginalName?: string }).unsafeOriginalName
    if (original !== undefined && original !== f.name) checkPath(original)
  }
  const entries = Object.values(zip.files).filter((f) => !f.dir && !JUNK(f.name))
  if (entries.length === 0) throw new PackageError('The package has no files.')
  if (entries.length > MAX_FILES) throw new PackageError(TOO_MANY)

  const paths = entries.map((f) => checkPath(f.name))
  // A lone skills/ folder is the usual layout inside a package, not a wrapper: it stays, and the file names it.
  const firstSegs = new Set(paths.map((p) => p.split('/')[0]))
  const lone = firstSegs.size === 1 && paths.every((p) => p.includes('/')) ? [...firstSegs][0] : null
  const root = lone && lone.toLowerCase() !== 'skills' ? `${lone}/` : ''

  let total = 0
  const files: SourceFile[] = []
  for (const f of entries) {
    if (isSymlink(f)) throw new PackageError(`The package has a link instead of a file: ${f.name.slice(0, 80)}`)
    const declared = declaredSize(f)
    if (declared !== null && (declared > MAX_FILE_BYTES || total + declared > MAX_TOTAL_BYTES)) throw new PackageError(TOO_BIG)
    const bytes = await f.async('uint8array')
    total += bytes.length
    if (bytes.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw new PackageError(TOO_BIG)
    const path = checkPath(f.name).slice(root.length)
    files.push({ path, bytes, exec: isExecutable(path, f) })
  }
  checkUnique(files)
  return { files, root }
}

/** Local leftovers a builder's folder collects (caches, environments, version control); never part of a package. */
const DIR_IGNORE = new Set(['.git', '.DS_Store', 'Thumbs.db', '__MACOSX', '__pycache__', '.venv', 'node_modules', '.pytest_cache'])
const ignored = (name: string) => DIR_IGNORE.has(name) || name.endsWith('.pyc')

/** The files of a package folder, checked with the same rules and limits as an uploaded ZIP. */
export async function readDir(dir: string): Promise<{ files: SourceFile[]; root: string }> {
  const top = await stat(dir).catch(() => null)
  if (!top?.isDirectory()) throw new PackageError(`${dir} isn't a folder.`)
  const found: Array<{ path: string; full: string }> = []
  const walk = async (rel: string): Promise<void> => {
    const entries = await readdir(join(dir, rel), { withFileTypes: true })
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored(e.name)) continue
      const path = rel ? `${rel}/${e.name}` : e.name
      if (e.isSymbolicLink()) throw new PackageError(`The package has a link instead of a file: ${path.slice(0, 80)}`)
      if (e.isDirectory()) await walk(path)
      else if (e.isFile()) {
        found.push({ path: checkPath(path), full: join(dir, path) })
        if (found.length > MAX_FILES) throw new PackageError(TOO_MANY)
      }
    }
  }
  await walk('')
  if (found.length === 0) throw new PackageError('The package has no files.')

  let total = 0
  const files: SourceFile[] = []
  for (const f of found) {
    const st = await stat(f.full)
    total += st.size
    if (st.size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw new PackageError(TOO_BIG)
    files.push({ path: f.path, bytes: new Uint8Array(await readFile(f.full)), exec: /\.(sh|py)$/.test(f.path) || (st.mode & 0o100) !== 0 })
  }
  checkUnique(files)
  return { files, root: '' }
}
