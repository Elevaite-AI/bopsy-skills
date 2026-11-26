#!/usr/bin/env node
// The installed `bopsy-skill` command. npm links it from node_modules/.bin, so cli.ts's own "am I the script?" check
// doesn't hold here: this file always runs the CLI. It runs where it was started: an INIT_CWD it inherits (from an
// npm or pnpm script that called it) can name another folder.
import { run } from './cli.js'

run(process.cwd())
