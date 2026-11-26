import JSZip from 'jszip'
import type { SourceFile } from './files.js'
import { MANIFEST_FILE } from './manifest.js'
import { packFiles } from './pack.js'
import type { PackageSkill } from './package.js'

/**
 * `pack --for <target>`: one package, in the shape each platform takes. Bopsy takes the whole package; Claude Code a
 * plugin (skills/<name>/ plus .claude-plugin/plugin.json); Codex skill folders; claude.ai and ChatGPT one ZIP per
 * skill, since each upload holds exactly one SKILL.md.
 */

export type Target = 'bopsy' | 'claude' | 'claude-ai' | 'codex' | 'chatgpt'
export const TARGETS: readonly Target[] = ['bopsy', 'claude', 'claude-ai', 'codex', 'chatgpt']
export const isTarget = (v: string): v is Target => (TARGETS as readonly string[]).includes(v)

export interface TargetInfo {
  slug: string
  version: string | null
  /** bopsy.json's description; the first skill's when there is none. */
  description?: string
  skills: PackageSkill[]
}

/** A file to write; `exec` marks a script that must stay executable in a folder target. */
export interface TargetOutput { path: string; bytes: Uint8Array; exec?: boolean }

/** Same date on every entry, so the same files always pack to the same bytes. */
const FIXED_DATE = new Date(Date.UTC(1980, 0, 1))
/** claude.ai's limit for a skill description on upload (the Agent Skills spec allows 1024). */
const UPLOAD_DESCRIPTION_MAX = 200
/** Files every target may leave out without saying so: they configure the package, not a skill. */
const PACKAGE_ONLY = new Set([MANIFEST_FILE, 'LICENSE', 'LICENSE.md', 'LICENSE.txt'])

const inDir = (path: string, dir: string) => dir === '' || path.startsWith(`${dir}/`)
const under = (path: string, dir: string) => (dir === '' ? path : path.slice(dir.length + 1))

/** A ZIP for other platforms: readable by anyone (their uploads unpack as another user), scripts executable. */
async function shareableZip(files: Array<{ path: string; bytes: Uint8Array; exec: boolean }>): Promise<Buffer> {
  const zip = new JSZip()
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    zip.file(f.path, f.bytes, { unixPermissions: f.exec ? 0o100755 : 0o100644, createFolders: false, date: FIXED_DATE })
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX' })
}

/** Each skill's own files, re-rooted under its name, and a note when shared files outside every skill are left out. */
function perSkill(files: SourceFile[], skills: PackageSkill[]): { bySkill: Array<{ skill: PackageSkill; files: SourceFile[] }>; notes: string[] } {
  const bySkill = skills.map((skill) => ({
    skill,
    files: files.filter((f) => inDir(f.path, skill.dir)).map((f) => ({ ...f, path: `${skill.name}/${under(f.path, skill.dir)}` })),
  }))
  const left = files.filter((f) => !PACKAGE_ONLY.has(f.path) && !skills.some((s) => inDir(f.path, s.dir)))
  const notes = left.length
    ? [`${left.length} files outside the skills' folders aren't included (e.g. ${left[0].path}): copy what the skills use into their folders.`]
    : []
  return { bySkill, notes }
}

export async function buildTarget(target: Target, files: SourceFile[], info: TargetInfo): Promise<{ outputs: TargetOutput[]; notes: string[] }> {
  if (target === 'bopsy') {
    return { outputs: [{ path: `${info.slug}${info.version ? `-${info.version}` : ''}.zip`, bytes: await packFiles(files) }], notes: [] }
  }

  if (target === 'claude') {
    const plugin = {
      name: info.slug,
      description: info.description ?? info.skills[0]?.description ?? '',
      version: info.version ?? '0.1.0',
    }
    const notes = info.skills
      .filter((s) => s.dir !== `skills/${s.name}`)
      .map((s) => `Claude Code only finds skills in skills/<name>/: move the skill "${s.name}" (${s.dir ? `in ${s.dir}` : 'at the package root'}) to skills/${s.name}/.`)
    return {
      outputs: [
        { path: '.claude-plugin/plugin.json', bytes: new TextEncoder().encode(`${JSON.stringify(plugin, null, 2)}\n`) },
        ...files.map((f) => ({ path: f.path, bytes: f.bytes, exec: f.exec })),
      ],
      notes,
    }
  }

  const { bySkill, notes } = perSkill(files, info.skills)
  if (target === 'codex') return { outputs: bySkill.flatMap((s) => s.files.map((f) => ({ path: f.path, bytes: f.bytes, exec: f.exec }))), notes }
  // claude-ai and chatgpt: one ZIP per skill, holding one folder with SKILL.md at its root.
  const outputs: TargetOutput[] = []
  for (const s of bySkill) outputs.push({ path: `${s.skill.name}.zip`, bytes: await shareableZip(s.files) })
  const long = info.skills
    .filter((s) => s.description.length > UPLOAD_DESCRIPTION_MAX)
    .map((s) => `The description of the skill "${s.name}" is ${s.description.length} characters long: claude.ai takes up to ${UPLOAD_DESCRIPTION_MAX}, so shorten it before uploading.`)
  return { outputs, notes: [...notes, ...long] }
}
