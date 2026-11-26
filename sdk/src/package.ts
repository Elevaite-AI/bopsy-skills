import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { MAX_SKILLS, PackageError, readDir, readZip, type SourceFile } from './files.js'
import { MANIFEST_FILE, parseManifest, readManifest, type DeclaredSetting, type Manifest, type NeedId } from './manifest.js'
import { packFiles } from './pack.js'

/**
 * A skill package: a set of Agent Skills folders (https://agentskills.io/specification, the format Pi loads). Each
 * skill is a folder with a SKILL.md (frontmatter `name` + `description`, then instructions) and optional scripts/,
 * references/ and assets/. A `bopsy.json` at the package root says what it needs from the workspace.
 */

const NAME_MAX = 64
const DESCRIPTION_MAX = 1024

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
// Agent Skills: lowercase letters, digits and single hyphens, not at either end.
const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export interface PackageSkill {
  name: string
  description: string
  /** The skill's folder inside the package ('' when SKILL.md is at its root). */
  dir: string
}

export interface ParsedPackage {
  slug: string
  name: string
  version: string | null
  skills: PackageSkill[]
  /** Things worth knowing that don't stop the install (a name that doesn't match its folder, skipped files). */
  warnings: string[]
  fileCount: number
  sizeBytes: number
  /** The cleaned package that goes to the machine: only the checked files, under the package's own root. */
  zip: Buffer
  sha256: string
  /** What it needs connected before its scripts work (bopsy.json). */
  needs: NeedId[]
  /** The settings it declares (bopsy.json): what the Skills page shows as named fields. */
  settings: DeclaredSetting[]
}

/** A SKILL.md's frontmatter, or why it has none we can use. */
export function parseFrontmatter(text: string): Record<string, unknown> {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(text)
  if (!m) throw new PackageError('it has no frontmatter (a --- block with name and description at the top)')
  let data: unknown
  try { data = parseYaml(m[1]) } catch { throw new PackageError("its frontmatter isn't valid YAML") }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PackageError("its frontmatter isn't a set of fields")
  return data as Record<string, unknown>
}

/** The package's short name, from the uploaded file's name: "meta-ads-os-skills-v0.4.zip" → meta-ads-os-skills. */
export function slugFromFileName(fileName: string): { slug: string; version: string | null } {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.zip$/i, '')
  const v = /[-_ ]v?(\d+(?:\.\d+){0,3})$/i.exec(base)
  const stem = v ? base.slice(0, v.index) : base
  // Word parts joined by single hyphens, cut to 64 without a trailing hyphen (no trimming regex over the raw name).
  let slug = stem.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join('-').slice(0, 64)
  while (slug.endsWith('-')) slug = slug.slice(0, -1)
  return { slug: SLUG_RE.test(slug) ? slug : 'skills', version: v ? v[1] : null }
}

const titleOf = (slug: string) => slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')

/**
 * The skills, name, version and needs of a package's files. `root` is the wrapper folder readZip stripped ('' for
 * none); `name` pins the folder name and version (a library package installs under the slug it was published with).
 */
export function inspectPackage(
  files: SourceFile[],
  naming: { fileName: string; root: string; name?: { slug: string; version: string | null } },
): Omit<ParsedPackage, 'zip' | 'sha256'> {
  const { fileName, root, name } = naming
  const warnings: string[] = []
  // Every folder with a SKILL.md is a skill, at any depth (as Pi discovers them).
  const skills: PackageSkill[] = []
  const versions: string[] = []
  for (const f of files.filter((x) => x.path === 'SKILL.md' || x.path.endsWith('/SKILL.md')).sort((a, b) => a.path.localeCompare(b.path))) {
    const dir = f.path.slice(0, -'SKILL.md'.length).replace(/\/$/, '')
    const where = dir || 'the package root'
    let fm: Record<string, unknown>
    try { fm = parseFrontmatter(Buffer.from(f.bytes).toString('utf8')) } catch (err) {
      throw new PackageError(`The SKILL.md in ${where} can't be used: ${err instanceof Error ? err.message : String(err)}.`)
    }
    const skillName = typeof fm.name === 'string' ? fm.name.trim() : ''
    const description = typeof fm.description === 'string' ? fm.description.trim().replace(/\s+/g, ' ') : ''
    if (!skillName || skillName.length > NAME_MAX || !SKILL_NAME_RE.test(skillName)) {
      throw new PackageError(`The SKILL.md in ${where} needs a name of up to ${NAME_MAX} lowercase letters, digits and single hyphens.`)
    }
    if (!description || description.length > DESCRIPTION_MAX) {
      throw new PackageError(`The skill "${skillName}" needs a description of up to ${DESCRIPTION_MAX} characters saying what it does and when to use it.`)
    }
    if (skills.some((s) => s.name === skillName)) throw new PackageError(`Two skills in the package are called "${skillName}".`)
    const folder = dir.split('/').pop() ?? ''
    if (dir && folder !== skillName) warnings.push(`The skill "${skillName}" is in a folder called "${folder}".`)
    const meta = fm.metadata && typeof fm.metadata === 'object' ? (fm.metadata as Record<string, unknown>) : {}
    if (typeof meta.version === 'string' || typeof meta.version === 'number') versions.push(String(meta.version))
    skills.push({ name: skillName, description, dir })
  }
  if (skills.length === 0) throw new PackageError('The package has no skills: no folder in it has a SKILL.md.')
  if (skills.length > MAX_SKILLS) throw new PackageError(`The package has too many skills (at most ${MAX_SKILLS}).`)

  // Named after its wrapper folder when it has one, else after the file.
  const fromFile = slugFromFileName(fileName)
  const fromRoot = root ? slugFromFileName(root.slice(0, -1)) : null
  const slug = name?.slug ?? (fromRoot && fromRoot.slug !== 'skills' ? fromRoot.slug : fromFile.slug)
  // The version every skill agrees on, else the one in the file or folder name.
  const agreed = versions.length === skills.length && new Set(versions).size === 1 ? versions[0] : null
  const version = (name ? name.version : (agreed ?? fromFile.version ?? fromRoot?.version))?.slice(0, 40) ?? null
  if (!SLUG_RE.test(slug)) throw new PackageError('Bad package name')

  const manifest = files.find((f) => f.path === MANIFEST_FILE)
  const declared = manifest ? parseManifest(Buffer.from(manifest.bytes).toString('utf8')) : { needs: [], settings: [], warnings: [] }
  warnings.push(...declared.warnings)

  const sizeBytes = files.reduce((n, f) => n + f.bytes.length, 0)
  return { slug, name: titleOf(slug), version, skills, warnings, fileCount: files.length, sizeBytes, needs: declared.needs, settings: declared.settings }
}

/** Reads, checks and cleans an uploaded package. Throws PackageError with a reason a person can act on. */
export async function parsePackage(data: Buffer, fileName: string, name?: { slug: string; version: string | null }): Promise<ParsedPackage> {
  const { files, root } = await readZip(data)
  const info = inspectPackage(files, { fileName, root, name })
  const zip = await packFiles(files)
  return { ...info, zip, sha256: createHash('sha256').update(zip).digest('hex') }
}

/**
 * A package's content, apart from how it was zipped: sha256 over each file's path, exec flag, length and bytes, in path
 * order. Two zips of the same folder can differ byte for byte; this doesn't.
 */
export function contentHash(files: SourceFile[]): string {
  const h = createHash('sha256')
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    h.update(f.path).update('\0').update(f.exec ? 'x' : '-').update('\0').update(String(f.bytes.length)).update('\0').update(f.bytes)
  }
  return h.digest('hex')
}

/** A package folder (a built-in in packages/skills), read and checked as an upload would be, named after the folder. */
export async function readPackageDir(dir: string): Promise<{ pkg: ParsedPackage; contentSha256: string; manifest: Manifest | null }> {
  const { files } = await readDir(dir)
  // basename ignores trailing slashes itself (a regex for them backtracks on long runs of slashes).
  const info = inspectPackage(files, { fileName: basename(dir), root: '' })
  const zip = await packFiles(files)
  const bopsy = files.find((f) => f.path === MANIFEST_FILE)
  return {
    pkg: { ...info, zip, sha256: createHash('sha256').update(zip).digest('hex') },
    contentSha256: contentHash(files),
    manifest: bopsy ? readManifest(Buffer.from(bopsy.bytes).toString('utf8')).manifest : null,
  }
}
