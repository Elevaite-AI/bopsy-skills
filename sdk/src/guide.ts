import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * The guide: this package's README, bundled with it (package.json `files`). It is what `bopsy-skill guide` prints and
 * what the skill creator and Bopsy's Build a skill using external agents prompts are made from.
 */

/** At the package root: one folder up from both src/ and dist/. */
export const readmePath = (): string => fileURLToPath(new URL('../README.md', import.meta.url))

export const readGuide = (): Promise<string> => readFile(readmePath(), 'utf8')
