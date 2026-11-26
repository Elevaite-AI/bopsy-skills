# @bopsy/skills

Build skill packages that install on [Bopsy](https://team.bopsy.ai) agents and still run as plain
[Agent Skills](https://agentskills.io) in Claude, Codex and ChatGPT.

```bash
npx @bopsy/skills new seo-audit        # start a package
npx @bopsy/skills check seo-audit      # check it the way Bopsy does
npx @bopsy/skills pack seo-audit       # write seo-audit.zip, ready to upload
```

**If you are a model building a skill for someone, read this whole file first, then follow
[Building a skill, step by step](#building-a-skill-step-by-step).** Every rule below is one that `check` enforces
or one Bopsy's install review looks for.

---

## What a package is

A package is a folder of one or more Agent Skills, with an optional `bopsy.json` at its root:

```
seo-audit/
├── bopsy.json                       # optional: what Bopsy should connect, ask for and install
├── LICENSE                          # recommended when you share it
└── skills/
    ├── seo-audit/                   # the first skill is named after the package
    │   ├── SKILL.md                 # required: frontmatter + instructions
    │   ├── scripts/crawl.py         # optional: code the skill runs
    │   ├── references/rubric.md     # optional: read only when SKILL.md says so
    │   └── assets/report-template.md
    └── geo-visibility/
        └── SKILL.md
```

Everything that matters runs from `SKILL.md`. `bopsy.json` only adds things Bopsy can do for the skill (connect an
app, ask for a setting). A package with no `bopsy.json` is still a valid Bopsy package.

### SKILL.md

```markdown
---
name: seo-audit
description: Audit a website's SEO and write a ranked fix list. Use when someone asks for an SEO audit, why a page
  isn't ranking, or what to fix first on a site.
---

# SEO audit

## When to use
- …

## Steps
1. …

## Never
- …
```

| Field | Rule |
|---|---|
| `name` | Up to 64 characters: lowercase letters, digits, single hyphens (`seo-audit`). Should match its folder. Unique in the package. |
| `description` | Up to 1024 characters. Say **what it does and when to use it**: the agent decides from this line alone whether to open the skill, so name the requests it is for. |

The body is instructions for another model. Write steps in order, say which script to run and what to do with its
output, and keep it under about 500 lines; put long material in `references/` and say when to read it.

---

## bopsy.json

```json
{
  "name": "SEO & GEO",
  "description": "Audits a site's search and AI-answer visibility and writes a ranked fix list.",
  "needs": [{ "integration": "decisions" }],
  "settings": [
    { "name": "SITE_URL", "description": "The site to audit, e.g. https://example.com" },
    { "name": "SERP_API_KEY", "description": "Your SerpAPI key, for ranking checks", "secret": true },
    {
      "name": "ENGINES", "type": "order", "description": "Which AI answer engines to check, in order",
      "options": [
        { "value": "chatgpt", "label": "ChatGPT" },
        { "value": "perplexity", "label": "Perplexity" },
        { "value": "gemini", "label": "Gemini" }
      ],
      "default": "chatgpt,perplexity"
    }
  ],
  "requires": ["python3"],
  "minPython": "3.10"
}
```

Every field is optional. Unknown fields are a warning and are ignored.

| Field | What it does | Limits |
|---|---|---|
| `name` | The package's display name. | 80 characters |
| `description` | Shown on the Skills page. | 1024 characters |
| `needs` | Apps Bopsy connects for the package before it installs (see [Needs](#needs)). | 20 |
| `settings` | Values the person sets per agent; scripts read them as environment variables (see [Settings](#settings)). | 30 |
| `requires` | Programs the scripts expect on the computer (`python3`, `ffmpeg`). Shown at install; the agent sets up what's missing in its own folders. | 20 |
| `minPython` | Lowest Python the scripts work with, like `"3.10"`. | |

### Settings

Each setting becomes an environment variable in every shell the agent runs, on its own computer.

| Key | Rule |
|---|---|
| `name` | Up to 64 of `A-Z`, digits and `_`, not starting with a digit (`SITE_URL`). Not a name that changes how programs start (`PATH`, `LD_PRELOAD`…) or one a need sets. |
| `description` | Required, up to 300 characters. People see it on the Skills page. |
| `default` | Optional, one line. Used until someone sets a value. |
| `secret` | `true` for keys, tokens and passwords. Secret values are never shown to people or to the agent's prompt, only to scripts. A name containing `KEY`, `TOKEN`, `SECRET` or `PASSWORD` that isn't secret is a warning. |
| `type` | `text` (default) or `order`. |
| `options` | For `order`: 1 to 20 `{ "value", "label" }`. People tick some and put them in order; scripts get the values joined by commas (`chatgpt,perplexity`). Values are lowercase letters, digits, `-` and `_`. An order setting can't be secret. |

Non-secret values are also listed under the package's skills in the agent's prompt, so the agent knows them without
reading the environment. Two packages on one agent can't declare the same setting name.

**Scripts must read settings from the environment and fail clearly when one is missing**: print what is missing and
where to set it ("SITE_URL isn't set: add it on the Skills page, or export it"), and exit non-zero. That one rule is
what lets the same script run in Bopsy, Claude Code and Codex.

### Needs

A need is an app the workspace connects once (Settings → Integrations). The vendor's token **stays on Bopsy's
server**: scripts get a proxy address and a key that only works for that agent, as settings the package can't set
itself.

| Need | Scripts get | For |
|---|---|---|
| `meta-ads` | `META_GRAPH_URL`, `META_ACCESS_TOKEN` | Reading Meta ad accounts through the Graph API (reads only). |
| `outline` | nothing | The skills use the Outline app's own tools. |
| `decisions` | `BOPSY_DECIDE_URL`, `BOPSY_DECIDE_KEY` | Quick yes/no, pick-one and 1-to-N judgements by the workspace's decision model. |

`check` lists the needs it knows. Any other connected app (Gmail, Google Drive, HubSpot, GitHub…) reaches the agent
as **tools**, not as settings: a skill uses them by telling the agent which tool to call, the same way it would in
Claude with an MCP server connected. Never ask the person to paste a vendor token into a setting when the vendor is
an app they can connect.

---

## How Bopsy runs a package

- **Install.** The package is checked, then reviewed (fixed rules, then a model reading every file); a person reads
  the report and installs it on one agent. It unpacks to `~/skills/<package>/` on that agent's computer.
- **The computer.** A Linux machine per workspace, with `bash`, `curl` and `python3`. The agent runs commands as its
  own user, without `sudo`. It may sleep when idle and wakes when the agent needs it (that can take a minute).
- **The prompt.** The agent sees each skill's name, description and path. When a task matches, it reads the
  `SKILL.md`, `cd`s into that skill's folder and runs the scripts from there, so **paths in a SKILL.md are relative
  to its own folder**.
- **Settings** are loaded into every shell from a private file; the prompt names secret settings but never holds
  their values.
- **Long tool results.** Every app tool in Bopsy takes an extra optional argument, `save_to_file: true`. The whole
  result is saved under `tool-results/` on the computer and the model gets only its start, end and path. Tell the
  agent to use it in your SKILL.md when a script will process the result (a long transcript, a full crawl), and
  have the script read the file. Elsewhere the argument doesn't exist, so say "if the tool offers `save_to_file`".
- **Skills hand work to each other by name** ("then use geo-visibility"). Keep each skill to one job.

---

## What the review flags

Fix these before you upload; `check` reports the same fixed rules.

**Blocks the install (high):** downloading a script and piping it to a shell; running code hidden in an encoded
string; reverse shells; `sudo`; reading credential files (`~/.ssh`, `~/.aws/credentials`, `.netrc`…); touching the
agent sandbox under `~/.aios/` (other than reading settings); compiled binaries or executables that aren't scripts.

**Needs a reason (medium/low):** hosts the scripts call, files they write outside their folder, packages they install.
Say in the SKILL.md why each host is called. Install dependencies into the skill's own folder
(`python3 -m venv .venv`), never system-wide.

**Size:** a ZIP up to 10 MB; up to 50 MB unpacked, 20 MB per file, 2000 files, 60 skills. Symlinks are refused.
`.DS_Store`, `Thumbs.db`, `__MACOSX` and `.git` are dropped.

---

## Making it work everywhere

Write the package as plain Agent Skills first; `bopsy.json` only adds to it.

| Do | Why |
|---|---|
| Put every instruction in `SKILL.md`, never only in `bopsy.json`. | Other platforms ignore `bopsy.json`. |
| Read settings from the environment and fail clearly when missing. | Claude Code / Codex users `export` them; Bopsy sets them. |
| Use standard Python 3 (or `bash`) with dependencies installed into the skill folder. | Every platform's computer has Python; few have your packages. |
| Say "if you have a tool for X, use it; otherwise ask the person to paste it". | Connected apps differ per platform. |
| Keep paths relative to the skill folder. | Each platform puts skills somewhere different. |

`pack --for` writes the right shape for each platform:

| Target | Command | Output |
|---|---|---|
| Bopsy | `pack` (default) | `seo-audit.zip`: the whole package. Upload it on the Skills page, or push the folder to a public GitHub repo and paste the link. |
| Claude Code | `pack --for claude` | A plugin folder (`.claude-plugin/plugin.json` + `skills/`) to add to a marketplace or `~/.claude/skills`. |
| Claude.ai | `pack --for claude-ai` | One ZIP per skill, for claude.ai's Skills settings. |
| Codex | `pack --for codex` | The skill folders, to copy into `~/.agents/skills` or a repo's `.agents/skills`. |
| ChatGPT | `pack --for chatgpt` | One ZIP per skill (ChatGPT takes one `SKILL.md` per upload). |

---

## Building a skill, step by step

For a model building a skill with someone. Ask one thing at a time and keep going until each step is done.

1. **The job.** Ask what they want the skill to do, for whom, and what a great result looks like. Ask for one real
   example of the input and the output they'd want.
2. **The systems.** Ask which apps it should read from or act in. For each: is it a Bopsy need, an app the agent
   has tools for, or neither (then a secret setting holding their key, and say so plainly)?
3. **The sources.** Ask what to learn from: documents, Drive folders, GitHub repos, community posts, videos,
   existing skills. Read them all with the tools you have, and say what you couldn't reach. Build a short rubric of
   what good looks like from them, and show it.
4. **Skill or plugin.** If it needs its own screen, buttons, stored records people browse, or a page that updates
   live, a skill alone won't do it: say so, and build the skill part that can run without it.
5. **Write it.** One skill per job. Descriptions that name the requests. Steps a stranger could follow. Scripts for
   anything that must be exact (maths, parsing, API calls); judgement in the SKILL.md. Settings for anything that
   differs per person.
6. **Check it.** Run `npx @bopsy/skills check <folder>` and fix every error. Where you can't run commands, go through
   [What the review flags](#what-the-review-flags) and the limits by hand.
7. **Try it.** Run it on their real example. Fix what the output gets wrong.
8. **Hand it over.** `npx @bopsy/skills pack <folder>` (and `--for <platform>` for anywhere else), or push it to a
   public GitHub repo. Tell them: upload the ZIP or paste the link on their agent's **Skills** page.

---

## Commands

| Command | |
|---|---|
| `new <slug> [--dir <parent>]` | Start a package in the current folder: one skill, a `scripts/` folder and a `bopsy.json`. |
| `check [dir]` | The checks Bopsy runs on upload plus the `bopsy.json` rules, with file and line. Exits 1 on any error. |
| `pack [dir] [--out <path>] [--for <target>]` | Check, then write the package next to its folder: a `.zip` for Bopsy, or a `<slug>-<target>` folder for another platform. Notes say what a platform leaves out. |
| `guide` | Print this file (what Bopsy's skill creator and the Copy prompt read). |

The same rules are a library: `import { checkPackage, readManifest } from '@bopsy/skills'`.

## Licence

MIT © Elevaite
