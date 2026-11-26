import { PackageError } from './files.js'

/** Names for the settings a package's scripts read: what the settings form accepts and bopsy.json may declare. */

export const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]{0,63}$/
export const MAX_ENV_KEYS = 30
// Names that would change how the shell or programs start, not configure a skill.
const RESERVED = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'PWD', 'OLDPWD', 'IFS', 'ENV', 'BASH_ENV', 'PS4', 'PROMPT_COMMAND', 'TERM', 'LANG', 'TMPDIR', 'PYTHONPATH', 'PYTHONSTARTUP', 'PYTHONHOME', 'NODE_OPTIONS'])

export function checkEnvKey(key: string): void {
  if (!ENV_KEY_RE.test(key)) throw new PackageError(`"${key.slice(0, 70)}" isn't a setting name we can use: capital letters, digits and _ only.`)
  if (RESERVED.has(key) || key.startsWith('LD_') || key.startsWith('BASH_FUNC_')) throw new PackageError(`${key} is reserved by the computer and can't be set here.`)
}
