/** The files `pnpm bopsy-skill new` writes: one skill, a scripts folder and a bopsy.json, ready to fill in. */

const titleOf = (slug: string) => slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')

export function skillTemplate(slug: string): Record<string, string> {
  return {
    'bopsy.json': `${JSON.stringify({ name: titleOf(slug), description: '', needs: [], settings: [] }, null, 2)}\n`,
    [`skills/${slug}/SKILL.md`]: `---
name: ${slug}
description: TODO what this skill does and when the agent should use it, in one or two sentences.
---

# ${titleOf(slug)}

## When to use

- TODO the requests or situations this skill is for.

## Steps

1. TODO the steps, in order. Run scripts from this folder: \`cd\` here first, then \`python3 scripts/<name>.py\`.

## Never

- Never print or repeat a setting's value (keys and tokens are already in your environment).
- Never change an account, send anything or spend money without the person's approval.
`,
    [`skills/${slug}/scripts/.gitkeep`]: '',
  }
}
