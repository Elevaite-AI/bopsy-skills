# Bopsy skills

Tools for building skill packages that install on [Bopsy](https://team.bopsy.ai) agents and still run as plain
[Agent Skills](https://agentskills.io) in Claude, Codex and ChatGPT.

```bash
npx @bopsy/skills new my-skill     # start a package
npx @bopsy/skills check my-skill   # check it the way Bopsy does
npx @bopsy/skills pack my-skill    # write my-skill.zip, ready to upload
```

- **[sdk/](sdk/README.md)**: the `@bopsy/skills` package and its guide: the package layout, `bopsy.json`, settings,
  needs, how Bopsy runs a package, what the review flags and how to make a package work everywhere. If you're a
  model building a skill, read [sdk/README.md](sdk/README.md) first.
- A Claude Code / Codex plugin that builds a skill with you is coming here next.

This repository is a copy published from Bopsy's own repo. See [CONTRIBUTING.md](CONTRIBUTING.md).

MIT © Elevaite
