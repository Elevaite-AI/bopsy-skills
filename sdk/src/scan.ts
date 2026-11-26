import JSZip from 'jszip'
import type { SourceFile } from './files.js'

/**
 * The fixed review rules: patterns over every file of a package, and what its scripts reach (hosts, settings,
 * installs). The server adds a model's reading on top (its skill review); the rules here count
 * whatever the model says, since the package text it reads could try to talk it out of a finding.
 */

export type Severity = 'high' | 'medium' | 'low' | 'info'

export interface Touches { network: string[]; files: string[]; settings: string[]; installs: string[] }

export interface Finding {
  severity: Severity
  /** Which rule, or 'ai' for the model's. */
  rule: string
  file: string
  line: number | null
  message: string
  /** A medium or low rule finding the model judged harmless in context, and why. High findings can't be dismissed. */
  dismissed?: string
}

export interface PackageFile { path: string; text: string | null; exec: boolean; size: number }

const SCRIPT_EXT = /\.(py|sh|bash|zsh|js|mjs|cjs|ts|rb|pl|php|ps1|lua)$/i
export const DOC_EXT = /\.(md|markdown|txt)$/i
const TEXT_EXT = /\.(py|sh|bash|zsh|js|mjs|cjs|ts|rb|pl|php|ps1|lua|md|markdown|txt|json|ya?ml|toml|cfg|ini|csv|html?|css|svg|xml|sql)$/i
export const isScript = (f: PackageFile) => SCRIPT_EXT.test(f.path) || (f.exec && f.text !== null && f.text.startsWith('#!'))

/** A package file as the review reads it: its text when it is a text file, else null. */
function toPackageFile(path: string, bytes: Uint8Array, exec: boolean): PackageFile {
  const looksText = TEXT_EXT.test(path) || path.endsWith('SKILL.md') || !bytes.subarray(0, 8000).includes(0)
  return { path, text: looksText ? Buffer.from(bytes).toString('utf8') : null, exec, size: bytes.length }
}

/** Every file of a package read from a folder or ZIP (files.ts), ready for the review. */
export function toPackageFiles(files: SourceFile[]): PackageFile[] {
  return files.map((f) => toPackageFile(f.path, f.bytes, f.exec)).sort((a, b) => a.path.localeCompare(b.path))
}

/** Every file of a cleaned package, with its text when it is a text file. */
export async function packageFiles(zip: Buffer): Promise<PackageFile[]> {
  const z = await JSZip.loadAsync(zip)
  const out: SourceFile[] = []
  for (const f of Object.values(z.files)) {
    if (f.dir) continue
    const exec = typeof f.unixPermissions === 'number' && (f.unixPermissions & 0o100) !== 0
    out.push({ path: f.name, bytes: await f.async('uint8array'), exec })
  }
  return toPackageFiles(out)
}

// ---------------------------------------------------------------------------------------------------------------
// Fixed rules.

interface Rule { id: string; severity: Severity; re: RegExp; message: string; on: 'script' | 'doc' | 'any' }

const RULES: Rule[] = [
  // Running code fetched or hidden at run time.
  { id: 'download-and-run', severity: 'high', on: 'any', re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, message: 'Downloads a script and runs it straight away.' },
  { id: 'hidden-code', severity: 'high', on: 'script', re: /\b(exec|eval)\s*\(\s*(base64\.b64decode|codecs\.decode|bytes\.fromhex|zlib\.decompress|marshal\.loads|atob|Buffer\.from)/, message: 'Runs code hidden in an encoded string.' },
  { id: 'hidden-shell', severity: 'high', on: 'any', re: /base64\s+(-d|--decode)[^\n]*\|\s*(ba|z)?sh\b/, message: 'Decodes text and runs it as a shell script.' },
  { id: 'reverse-shell', severity: 'high', on: 'any', re: /\/dev\/tcp\/|\bnc\s+(-\w+\s+)*-e\b|\bsocat\b[^\n]*exec:|\bpty\.spawn\(/, message: 'Looks like a remote shell (opens a shell for someone on the network).' },
  // Reaching beyond its own folder.
  { id: 'root', severity: 'high', on: 'script', re: /(^|[\s;&|`(])sudo\s/m, message: 'Tries to run something as root.' },
  { id: 'secrets-files', severity: 'high', on: 'any', re: /(\.ssh\/(id_|authorized_keys)|\/etc\/shadow|\.aws\/credentials|\.config\/gcloud|\.netrc|\.docker\/config\.json|\.kube\/config)/, message: 'Reads a credentials file outside the package.' },
  { id: 'agent-secrets', severity: 'high', on: 'any', re: /\.aios\/(?!skill-env)|aios-agents-run|\/usr\/local\/lib\/aios-agents/, message: "Touches the computer's agent sandbox files." },
  { id: 'persistence', severity: 'medium', on: 'script', re: /\bcrontab\s|systemctl\s+(enable|start)|\/etc\/(systemd|cron|init\.d)|\.bashrc|\.profile\b|\.bash_profile|autostart/, message: 'Sets something to start on its own later.' },
  { id: 'wipe', severity: 'medium', on: 'script', re: /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|\$HOME)(\s|$|\/\s|\*)/, message: 'Deletes whole folders at the top of the computer or home.' },
  { id: 'env-dump', severity: 'medium', on: 'script', re: /(^|[;&|]\s*)(printenv|env)\s*($|[|>])|print\(\s*os\.environ\s*\)|json\.dumps\(\s*(dict\()?os\.environ\s*\)|JSON\.stringify\(\s*process\.env\s*\)/, message: 'Prints or saves all environment settings (they can hold keys).' },
  { id: 'setuid', severity: 'medium', on: 'script', re: /chmod\s+[ugo]*\+s\b|chmod\s+[0-7]?[4-7][0-7]{3}\b/, message: 'Makes a program run with extra privileges.' },
  // Dependencies: worth knowing, not wrong.
  { id: 'installs', severity: 'info', on: 'any', re: /\b(pip3?|uv|poetry)\s+(install|add)\b|\bnpm\s+(i|install)\b|\bapt(-get)?\s+install\b|\bbrew\s+install\b/, message: 'Installs software when it runs.' },
  // Instructions aimed at the agent rather than the task. Medium, not high: skills often quote these phrases to warn
  // the agent about them, so the model judges them in context (see DEFENSIVE below).
  { id: 'prompt-injection', severity: 'medium', on: 'doc', re: /\b(ignore|disregard|forget)\b[^\n]{0,40}\b(previous|prior|above|earlier|all|any|your)\b[^\n]{0,30}\b(instructions?|rules|prompt|guidelines)\b/i, message: 'Tells the agent to ignore its instructions.' },
  { id: 'secret-exfiltration', severity: 'medium', on: 'doc', re: /\b(send|post|upload|email|forward|share)\b[^\n]{0,60}\b(token|password|api[ _-]?key|secret|credential|private key|\.env)\b[^\n]{0,60}\b(to|at)\b[^\n]{0,20}(https?:\/\/|@)/i, message: 'Asks the agent to send a secret somewhere.' },
  { id: 'hide-from-user', severity: 'medium', on: 'doc', re: /\b(do not|don't|never)\s+(tell|mention|show|reveal|inform)\b[^\n]{0,30}\b(the )?(user|human|person|owner)\b/i, message: 'Tells the agent to keep something from the person it works for.' },
]

const URL_RE = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/gi
const ENV_RE = /(?:os\.environ(?:\.get)?\(\s*|os\.environ\[\s*|os\.getenv\(\s*|process\.env\.|process\.env\[\s*|\$\{?)['"]?([A-Z][A-Z0-9_]{2,63})\b/g
const IGNORED_HOSTS = /(^|\.)(example\.[a-z.]+|example|localhost|agentskills\.io|[a-z0-9-]+\.(invalid|test|local))$/
const IS_TEST = (path: string) => /(^|\/)(tests?|fixtures|evals)\//.test(path) || /(^|\/)test_[^/]*$|_test\.[a-z]+$/.test(path)
/** A doc line that names an attack to resist it ("treat … as data, never instructions"), or quotes the phrase. */
const DEFENSIVE = /\b(untrusted|not instructions|never instructions|as data\b|do not act on|don't act on|instruction-like|aimed at an ai)/i
const QUOTED = (line: string, re: RegExp) => {
  const m = re.exec(line)
  if (!m) return false
  const before = line.slice(0, m.index)
  return /["'“‘`]\s*$/.test(before) || (before.split(/["“]/).length - 1) % 2 === 1
}

/** Fixed rules over every text file, plus what the scripts reach: hosts, settings, installs. */
export function staticScan(files: PackageFile[]): { findings: Finding[]; touches: Touches } {
  const findings: Finding[] = []
  const network = new Set<string>()
  const settings = new Set<string>()
  const installs = new Set<string>()
  for (const f of files) {
    if (f.text === null) {
      if (f.exec || /\.(so|dylib|dll|exe|bin)$/i.test(f.path)) {
        findings.push({ severity: 'high', rule: 'binary', file: f.path, line: null, message: 'A compiled program: it can do anything and can\'t be read.' })
      }
      continue
    }
    const kind = isScript(f) ? 'script' : DOC_EXT.test(f.path) ? 'doc' : 'other'
    const lines = f.text.split('\n')
    lines.forEach((line, i) => {
      for (const r of RULES) {
        if (r.on !== 'any' && r.on !== kind) continue
        if (r.on === 'doc' && (DEFENSIVE.test(line) || QUOTED(line, r.re))) continue
        if (r.re.test(line)) {
          findings.push({ severity: r.severity, rule: r.id, file: f.path, line: i + 1, message: r.message })
          if (r.id === 'installs') installs.add(line.trim().slice(0, 120))
        }
      }
      if (kind === 'script' && !IS_TEST(f.path)) {
        for (const m of line.matchAll(URL_RE)) if (!IGNORED_HOSTS.test(m[1].toLowerCase())) network.add(m[1].toLowerCase())
        for (const m of line.matchAll(ENV_RE)) settings.add(m[1])
      }
    })
  }
  // One finding per rule per file is enough to read; keep the first line of each.
  const seen = new Set<string>()
  const deduped = findings.filter((f) => { const k = `${f.rule}|${f.file}`; if (seen.has(k)) return false; seen.add(k); return true })
  return {
    findings: deduped,
    touches: { network: [...network].sort(), files: [], settings: [...settings].sort(), installs: [...installs].slice(0, 20) },
  }
}
