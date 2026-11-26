/**
 * The skill creator, made from the guide (this package's README) so its instructions can't drift from it: the
 * `bopsy-skill-creator` skill (Claude Code / Codex plugin, claude.ai and ChatGPT upload) and the paste-in prompts
 * (`bopsy-skill prompt`, Bopsy's Build a skill → Copy prompt).
 */

export const CREATOR_SKILL = 'bopsy-skill-creator'
/** At most 200 characters: claude.ai's limit for a skill description. */
export const CREATOR_DESCRIPTION =
  'Builds a skill package with you that installs on Bopsy agents and runs in Claude, Codex and ChatGPT. Use when someone wants to make, package or fix an Agent Skill.'

export type CreatorHost = 'claude-code' | 'codex' | 'claude-ai' | 'chatgpt'
export const CREATOR_HOSTS: readonly CreatorHost[] = ['claude-code', 'codex', 'claude-ai', 'chatgpt']
export const isCreatorHost = (v: string): v is CreatorHost => (CREATOR_HOSTS as readonly string[]).includes(v)

const STEPS = 'Building a skill, step by step'

/** The body of the guide's `## <heading>` section, up to the next `## ` heading, without the closing `---`. */
export function guideSection(guide: string, heading: string): string {
  const lines = guide.split('\n')
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`)
  if (start < 0) throw new Error(`The guide has no "## ${heading}" section.`)
  const rest = lines.slice(start + 1)
  // A `## ` line inside a code block (an example SKILL.md) isn't the next section.
  let fenced = false
  const end = rest.findIndex((l) => {
    if (l.trimStart().startsWith('```')) fenced = !fenced
    return !fenced && l.startsWith('## ')
  })
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').replace(/\n-{3,}\s*$/, '').trim()
}

/** In-page links (`[text](#anchor)`) don't work outside the README: name the section and where it is instead. */
// One pass, no regex: a regex over `[text](#anchor)` backtracks quadratically on text full of brackets.
export function unlink(text: string, where: string): string {
  let out = ''
  let i = 0
  for (;;) {
    const close = text.indexOf('](#', i)
    const end = close < 0 ? -1 : text.indexOf(')', close + 3)
    if (end < 0) break
    const before = text.slice(i, close)
    const open = before.lastIndexOf('[')
    const label = open < 0 ? '' : before.slice(open + 1)
    if (label && !label.includes(']') && end > close + 3) {
      out += `${before.slice(0, open)}"${label}" in ${where}`
      i = end + 1
    } else {
      out += text.slice(i, close + 1)
      i = close + 1
    }
  }
  return out + text.slice(i)
}

// One line each: they go inside list items, where a hard line break would read as a new paragraph in some renderers.
const WITH_TERMINAL = (where: string, tools: string) => [
  'You can run commands. Start the package with `npx @bopsy/skills new <slug>`, run `npx @bopsy/skills check <folder>`',
  'after every change and fix every error, and hand it over with `npx @bopsy/skills pack <folder>` (add `--for claude`,',
  '`claude-ai`, `codex` or `chatgpt` for other platforms). If `npx @bopsy/skills` isn\'t available (no Node or no',
  `network), write the files yourself and check them by hand against "What the review flags" and the limits in ${where}.`,
  tools,
].join(' ')

const IN_CHAT = (where: string, files: string) => [
  "You probably can't run `npx` or reach the internet from here, so check the package by hand: go through",
  `"What the review flags" and the limits in ${where}, and fix anything they would catch. ${files}`,
  'Tell the person Bopsy checks it again when they upload it.',
].join(' ')

const HOSTS: Record<CreatorHost, { name: string; where: (guide: string) => string }> = {
  'claude-code': { name: 'Claude Code', where: (w) => WITH_TERMINAL(w, 'Use your file, web and connector tools to read the sources.') },
  codex: { name: 'Codex', where: (w) => WITH_TERMINAL(w, 'Use your file and web tools to read the sources.') },
  'claude-ai': {
    name: 'a claude.ai chat',
    where: (w) => IN_CHAT(w, 'Write the files with code execution and give the person a ZIP of the package folder.'),
  },
  chatgpt: {
    name: 'ChatGPT',
    where: (w) => IN_CHAT(w, 'Write the files with your Python tool and give the person a ZIP of the package folder; if you have none, give each file to save.'),
  },
}

/** The creator skill's SKILL.md: the guide's steps for any host, with the guide itself in references/guide.md. */
export function creatorSkillMd(guide: string): string {
  const where = 'references/guide.md'
  return `---
name: ${CREATOR_SKILL}
description: ${CREATOR_DESCRIPTION}
---

# Bopsy skill creator

Build a skill package with the person: a folder of Agent Skills that installs on their Bopsy agents and also runs
in Claude, Codex and ChatGPT.

Read ${where} in full before you start. It is the @bopsy/skills guide, and every rule in it is one Bopsy checks
when the package is uploaded.

## Where you are

- **With a terminal** (Claude Code, Codex, a computer): ${WITH_TERMINAL(where, 'Use your file, web and connector tools to read the sources.')}
- **In a chat without one** (claude.ai, ChatGPT): ${IN_CHAT(where, 'Give the person a ZIP of the package folder, or each file to save.')}

## ${STEPS}

${unlink(guideSection(guide, STEPS), where)}
`
}

/** A prompt to paste into a chat on `host`: who it is, the steps, then the whole guide. */
export function creatorPrompt(host: CreatorHost, guide: string): string {
  const h = HOSTS[host]
  const where = 'the guide below'
  return `I want to build a skill package for Bopsy with you, here in ${h.name}. Follow the steps below, asking me one
thing at a time. Read the whole guide after them first: it is the @bopsy/skills guide, and every rule in it is one
Bopsy checks when I upload the package.

## Where you are

${h.where(where)}

## ${STEPS}

${unlink(guideSection(guide, STEPS), where)}

## The guide

${guide.trim()}
`
}
