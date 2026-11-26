---
name: bopsy-skill-creator
description: Builds a skill package with you that installs on Bopsy agents and runs in Claude, Codex and ChatGPT. Use when someone wants to make, package or fix an Agent Skill.
---

# Bopsy skill creator

Build a skill package with the person: a folder of Agent Skills that installs on their Bopsy agents and also runs
in Claude, Codex and ChatGPT.

Read references/guide.md in full before you start. It is the @bopsy/skills guide, and every rule in it is one Bopsy checks
when the package is uploaded.

## Where you are

- **With a terminal** (Claude Code, Codex, a computer): You can run commands. Start the package with `npx @bopsy/skills new <slug>`, run `npx @bopsy/skills check <folder>` after every change and fix every error, and hand it over with `npx @bopsy/skills pack <folder>` (add `--for claude`, `claude-ai`, `codex` or `chatgpt` for other platforms). If `npx @bopsy/skills` isn't available (no Node or no network), write the files yourself and check them by hand against "What the review flags" and the limits in references/guide.md. Use your file, web and connector tools to read the sources.
- **In a chat without one** (claude.ai, ChatGPT): You probably can't run `npx` or reach the internet from here, so check the package by hand: go through "What the review flags" and the limits in references/guide.md, and fix anything they would catch. Give the person a ZIP of the package folder, or each file to save. Tell the person Bopsy checks it again when they upload it.

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
   "What the review flags" in references/guide.md and the limits by hand.
7. **Try it.** Run it on their real example. Fix what the output gets wrong.
8. **Hand it over.** `npx @bopsy/skills pack <folder>` (and `--for <platform>` for anywhere else), or push it to a
   public GitHub repo. Tell them: upload the ZIP or paste the link on their agent's **Skills** page.
