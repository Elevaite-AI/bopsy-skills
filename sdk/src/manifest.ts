import { checkEnvKey, MAX_ENV_KEYS } from './env-keys.js'

/**
 * `bopsy.json`, at a package's root: what the package needs from the workspace and what the install should know.
 *
 *   {
 *     "name": "Meta Ads OS", "description": "…",
 *     "needs": [{ "integration": "meta-ads" }],
 *     "settings": [{ "name": "META_WORKSPACE", "description": "Where client workspaces live", "default": "~/clients" }],
 *     "requires": ["python3", "ffmpeg"]
 *   }
 *
 * Needs are what Bopsy can hand to scripts (NEEDS), mostly Integrations catalog ids (the apps a workspace can connect):
 * the token stays on the server, and the scripts get a proxy address and a key for that agent as managed settings.
 * `decisions` is not a catalog app: it is the workspace's decision model (Settings → Models → Decisions).
 */

export const NEEDS = {
  'meta-ads': {
    label: 'Meta Ads',
    /** Settings its scripts get: the proxy address and a key that only works there, for this agent. */
    env: ['META_GRAPH_URL', 'META_ACCESS_TOKEN'],
    about: "Read Meta (Facebook/Instagram) ad accounts through Bopsy, with the workspace's Meta system user token.",
  },
  outline: {
    label: 'Outline wiki',
    /** Nothing for scripts: the skills use the Outline app's own tools, which the agent gets from the app. */
    env: [],
    about: "Search, read and write the workspace's Outline wiki with the Outline app's tools (writes ask first).",
  },
  decisions: {
    label: 'Decision model',
    env: ['BOPSY_DECIDE_URL', 'BOPSY_DECIDE_KEY'],
    about: 'Quick yes/no, pick-one and 1-to-N judgements through the workspace\'s decision model.',
  },
} as const

export type NeedId = keyof typeof NEEDS
export const isNeed = (v: unknown): v is NeedId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(NEEDS, v)

/** Settings no one may set by hand: a connection writes them. */
export const MANAGED_KEYS: ReadonlySet<string> = new Set(Object.values(NEEDS).flatMap((n) => [...n.env]))

export const MANIFEST_FILE = 'bopsy.json'

/** One choice of an order setting: `value` is what scripts see, `label` what people see. */
export interface SettingOption { value: string; label: string }

/**
 * A setting a package declares. `text` (secret or not) is free text; `order` is some of `options`, ticked and put in
 * order, stored as their values joined by commas ("fireflies,meetgeek").
 */
export interface DeclaredSetting {
  name: string
  description: string
  default?: string
  secret: boolean
  type: 'text' | 'order'
  options?: SettingOption[]
}

export const MAX_SETTING_OPTIONS = 20
/** A setting value's limit in the settings file (the server's MAX_ENV_VALUE). */
export const MAX_SETTING_VALUE = 4096
export const OPTION_VALUE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/
const OPTION_LABEL_MAX = 60
/** A non-secret setting's value reaches the browser and the agent's prompt; these names usually hold a secret. */
const KEY_LIKE = /KEY|TOKEN|SECRET|PASSWORD/

export interface Manifest {
  name?: string
  description?: string
  needs: NeedId[]
  settings: DeclaredSetting[]
  requires: string[]
  minPython?: string
}

export interface Problem {
  level: 'error' | 'warning'
  file: string
  line: number | null
  message: string
  /** Which part of bopsy.json it's about; the server's upload path reports only json and needs. */
  field?: 'json' | 'needs' | 'settings' | 'requires' | 'other'
}

const KNOWN = new Set(['name', 'description', 'needs', 'settings', 'requires', 'minPython'])
const REQUIRE_RE = /^[a-z0-9][a-z0-9._+-]{0,40}$/
const SETTING_DESCRIPTION_MAX = 300

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

/** The id nearest to `id`, when it is near enough to be a typo of it. */
export function closestId(id: string, ids: Iterable<string>): string | null {
  let best: string | null = null
  let bestD = Infinity
  for (const c of ids) {
    const d = levenshtein(id, c)
    if (d < bestD) { best = c; bestD = d }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(id.length / 3)) ? best : null
}

/**
 * Reads a bopsy.json. With `catalogIds` (the CLI), a need outside the catalog or that Bopsy can't provide is an
 * error; without (an upload), it's a warning and the package still installs.
 */
export function readManifest(text: string, opts: { strict?: boolean; catalogIds?: ReadonlySet<string> } = {}): { manifest: Manifest; problems: Problem[] } {
  const manifest: Manifest = { needs: [], settings: [], requires: [] }
  const problems: Problem[] = []
  const add = (level: Problem['level'], field: Problem['field'], message: string) => problems.push({ level, file: MANIFEST_FILE, line: null, message, field })

  let o: unknown
  try { o = JSON.parse(text.replace(/^﻿/, '')) } catch {
    add('error', 'json', `${MANIFEST_FILE} isn't valid JSON, so its needs were ignored.`)
    return { manifest, problems }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) {
    add('error', 'other', `${MANIFEST_FILE} should be an object ({ … }).`)
    return { manifest, problems }
  }
  const m = o as Record<string, unknown>

  // Checking (the CLI), a need that would be ignored on install is an error; an upload only warns.
  const strict = opts.strict === true || !!opts.catalogIds
  const list = m.needs
  if (list !== undefined && !Array.isArray(list)) add(strict ? 'error' : 'warning', 'needs', `${MANIFEST_FILE}: "needs" should be a list.`)
  if (strict && Array.isArray(list) && list.length > 20) add('error', 'needs', `${MANIFEST_FILE}: at most 20 needs.`)
  for (const item of Array.isArray(list) ? list.slice(0, 20) : []) {
    const id = typeof item === 'string' ? item : (item as { integration?: unknown })?.integration
    if (isNeed(id)) { if (!manifest.needs.includes(id)) manifest.needs.push(id); continue }
    if (strict && typeof id !== 'string') {
      add('error', 'needs', `${MANIFEST_FILE}: each need should be {"integration": "<need id>"} or the id itself.`)
      continue
    }
    const shown = String(id).slice(0, 60)
    if (strict && !opts.catalogIds) {
      // Outside the repo there's no catalog to tell "not an app" from "not connectable yet": what installs is NEEDS.
      const near = typeof id === 'string' ? closestId(id, Object.keys(NEEDS)) : null
      add('error', 'needs', `${MANIFEST_FILE}: "${shown}" isn't something Bopsy can connect (it knows ${Object.keys(NEEDS).join(', ')}).${near ? ` Did you mean "${near}"?` : ''}`)
    } else if (opts.catalogIds && !(typeof id === 'string' && opts.catalogIds.has(id))) {
      const near = typeof id === 'string' ? closestId(id, opts.catalogIds) : null
      add('error', 'needs', `${MANIFEST_FILE}: "${shown}" isn't in the Integrations catalog.${near ? ` Did you mean "${near}"?` : ''}`)
    } else {
      add(opts.catalogIds ? 'error' : 'warning', 'needs', `The package needs "${shown}", which Bopsy can't connect yet; skills that use it won't work.`)
    }
  }

  if (m.settings !== undefined) {
    if (!Array.isArray(m.settings)) add('error', 'settings', `${MANIFEST_FILE}: "settings" should be a list.`)
    else {
      if (m.settings.length > MAX_ENV_KEYS) add('error', 'settings', `${MANIFEST_FILE}: at most ${MAX_ENV_KEYS} settings.`)
      for (const s of m.settings.slice(0, MAX_ENV_KEYS)) {
        const name = typeof (s as { name?: unknown })?.name === 'string' ? (s as { name: string }).name : ''
        try { checkEnvKey(name) } catch (err) { add('error', 'settings', `${MANIFEST_FILE}: ${(err as Error).message}`); continue }
        if (MANAGED_KEYS.has(name)) { add('error', 'settings', `${MANIFEST_FILE}: ${name} is set by a connection (needs), so a package can't declare it.`); continue }
        if (manifest.settings.some((x) => x.name === name)) { add('error', 'settings', `${MANIFEST_FILE}: the setting ${name} is listed twice.`); continue }
        const { description, default: def, secret } = s as { description?: unknown; default?: unknown; secret?: unknown }
        if (typeof description !== 'string' || !description.trim() || description.length > SETTING_DESCRIPTION_MAX) {
          add('error', 'settings', `${MANIFEST_FILE}: the setting "${name}" needs a description (up to ${SETTING_DESCRIPTION_MAX} characters).`)
          continue
        }
        if (def !== undefined && typeof def !== 'string') { add('error', 'settings', `${MANIFEST_FILE}: the default for ${name} should be text.`); continue }
        // The default is written to the settings file every shell run loads, under the same rules as a value set there.
        // eslint-disable-next-line no-control-regex
        if (def !== undefined && (def.length > MAX_SETTING_VALUE || /[\u0000\n\r]/.test(def))) {
          add('error', 'settings', `${MANIFEST_FILE}: the default for ${name} must be one line of up to ${MAX_SETTING_VALUE} characters.`)
          continue
        }
        if (secret !== undefined && typeof secret !== 'boolean') { add('error', 'settings', `${MANIFEST_FILE}: "secret" for ${name} should be true or false.`); continue }
        const type = (s as { type?: unknown }).type ?? 'text'
        if (type !== 'text' && type !== 'order') {
          add('error', 'settings', `${MANIFEST_FILE}: the setting ${name} has an unknown type "${String(type).slice(0, 30)}" (text or order).`)
          continue
        }
        const base = { name, description: description.trim(), secret: secret === true }
        if (type === 'text') {
          if (!base.secret && KEY_LIKE.test(name)) {
            add('warning', 'settings', `${MANIFEST_FILE}: ${name} looks like a key but isn't "secret": true, so its value would be shown to people and the agent.`)
          }
          manifest.settings.push({ ...base, type, ...(def !== undefined ? { default: def } : {}) })
          continue
        }
        if (base.secret) { add('error', 'settings', `${MANIFEST_FILE}: the order setting ${name} can't be secret.`); continue }
        const order = readOrder(name, (s as { options?: unknown }).options, def)
        if (typeof order === 'string') { add('error', 'settings', `${MANIFEST_FILE}: ${order}`); continue }
        manifest.settings.push({ ...base, type, options: order.options, ...(order.default !== undefined ? { default: order.default } : {}) })
      }
    }
  }

  if (m.requires !== undefined) {
    if (!Array.isArray(m.requires)) add('error', 'requires', `${MANIFEST_FILE}: "requires" should be a list of program names.`)
    else {
      if (m.requires.length > 20) add('error', 'requires', `${MANIFEST_FILE}: at most 20 programs in "requires".`)
      for (const r of m.requires.slice(0, 20)) {
        if (typeof r === 'string' && REQUIRE_RE.test(r)) { if (!manifest.requires.includes(r)) manifest.requires.push(r) }
        else add('error', 'requires', `${MANIFEST_FILE}: "${String(r).slice(0, 60)}" isn't a program name (like python3 or ffmpeg).`)
      }
    }
  }

  if (m.minPython !== undefined) {
    if (typeof m.minPython === 'string' && /^\d+\.\d+$/.test(m.minPython)) manifest.minPython = m.minPython
    else add('error', 'other', `${MANIFEST_FILE}: "minPython" should look like "3.10".`)
  }
  if (m.name !== undefined) {
    if (typeof m.name === 'string' && m.name.trim() && m.name.length <= 80) manifest.name = m.name.trim()
    else add('error', 'other', `${MANIFEST_FILE}: "name" should be text of up to 80 characters.`)
  }
  if (m.description !== undefined) {
    if (typeof m.description === 'string' && m.description.length <= 1024) manifest.description = m.description.trim()
    else add('error', 'other', `${MANIFEST_FILE}: "description" should be text of up to 1024 characters.`)
  }

  for (const k of Object.keys(m)) if (!KNOWN.has(k)) add('warning', 'other', `${MANIFEST_FILE}: unknown field "${k.slice(0, 60)}" (ignored).`)
  return { manifest, problems }
}

/** An order setting's options and default, checked; or why not, naming the setting. */
function readOrder(name: string, raw: unknown, def: string | undefined): { options: SettingOption[]; default?: string } | string {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SETTING_OPTIONS) {
    return `the order setting ${name} needs 1 to ${MAX_SETTING_OPTIONS} options.`
  }
  const options: SettingOption[] = []
  for (const o of raw) {
    const { value, label } = (o ?? {}) as { value?: unknown; label?: unknown }
    if (typeof value !== 'string' || !OPTION_VALUE_RE.test(value)) {
      return `${name}: option values are lowercase letters, digits, - and _ (up to 40 characters), not "${String(value).slice(0, 40)}".`
    }
    if (typeof label !== 'string' || !label.trim() || label.trim().length > OPTION_LABEL_MAX) {
      return `${name}: the option "${value}" needs a label of up to ${OPTION_LABEL_MAX} characters.`
    }
    if (options.some((x) => x.value === value)) return `${name}: the option "${value}" is listed twice.`
    options.push({ value, label: label.trim() })
  }
  if (def === undefined) return { options }
  const parts = def.split(',').map((p) => p.trim())
  const unknown = parts.find((p) => !options.some((o) => o.value === p))
  if (unknown !== undefined) return `${name}: the default names "${unknown.slice(0, 40)}", which isn't one of its options.`
  if (new Set(parts).size !== parts.length) return `${name}: the default lists an option twice.`
  return { options, default: parts.join(',') }
}

/** For uploads: the needs we know, plus a note for each one we don't (it installs; that part won't work). */
export function parseManifest(text: string): { needs: NeedId[]; settings: DeclaredSetting[]; warnings: string[] } {
  const { manifest, problems } = readManifest(text)
  // A setting that fails its checks is skipped (the package still installs), and the upload says so.
  const shown = problems.filter((p) => p.field === 'json' || p.field === 'needs' || p.field === 'settings')
  return { needs: manifest.needs, settings: manifest.settings, warnings: shown.map((p) => p.message) }
}
