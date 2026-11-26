# Bopsy skills

Tools for building skill packages that install on [Bopsy](https://team.bopsy.ai) agents and still run as plain
[Agent Skills](https://agentskills.io) in Claude, Codex and ChatGPT.

## Build a skill with the skill creator

The **Bopsy skill creator** interviews you about the job, reads your sources, writes the package, checks it the way
Bopsy does and hands you a ZIP to upload on your agent's **Skills** page. Pick where you work:

**Claude Code**

```
/plugin marketplace add Elevaite-AI/bopsy-skills
/plugin install bopsy-skill-creator@bopsy-skills
```

**Codex**

```bash
codex plugin marketplace add Elevaite-AI/bopsy-skills
codex plugin add bopsy-skill-creator@bopsy-skills
```

Or install just the skill: ask Codex to `$skill-installer install https://github.com/Elevaite-AI/bopsy-skills/tree/main/plugins/bopsy-skill-creator/skills/bopsy-skill-creator`.

**claude.ai** (Free and paid plans, with code execution on): download
[bopsy-skill-creator.zip](https://github.com/Elevaite-AI/bopsy-skills/raw/main/downloads/bopsy-skill-creator.zip)
and upload it under **Customize → Skills**.

**ChatGPT**: with Skills (Business, Enterprise and Edu), upload the same
[ZIP](https://github.com/Elevaite-AI/bopsy-skills/raw/main/downloads/bopsy-skill-creator.zip) under
**Plugins → Skills → Create**. On other plans, paste [CHATGPT.md](https://raw.githubusercontent.com/Elevaite-AI/bopsy-skills/main/CHATGPT.md)
into a new chat as your first message.

Then ask it to build what you want, e.g. "build me a skill that audits a site's SEO and GEO".

## Build one yourself

```bash
npx @bopsy/skills new my-skill     # start a package
npx @bopsy/skills check my-skill   # check it the way Bopsy does
npx @bopsy/skills pack my-skill    # write my-skill.zip, ready to upload
```

**[sdk/](sdk/README.md)** is the `@bopsy/skills` package and its guide: the package layout, `bopsy.json`, settings,
needs, how Bopsy runs a package, what the review flags and how to make a package work everywhere. If you're a model
building a skill, read [sdk/README.md](sdk/README.md) first.

This repository is a copy published from Bopsy's own repo. See [CONTRIBUTING.md](CONTRIBUTING.md).

MIT © Elevaite
