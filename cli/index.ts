#!/usr/bin/env bun
import { init } from "./commands/init"
import { update } from "./commands/update"
import { docs } from "./commands/docs"

const [, , command, ...args] = process.argv

const help = `
ml-labs — Claude-native ML platform

USAGE
  ml-labs init [project-name]   Scaffold a new ML-Labs project
  ml-labs update                Pull latest ML-Labs and rebuild
  ml-labs docs                  Serve the ML-Labs docs site locally

EXAMPLES
  ml-labs init my-classifier
  ml-labs init .                Wire ML-Labs into the current directory
  ml-labs update
  ml-labs docs
`

switch (command) {
  case "init":
    await init(args[0] ?? ".")
    break
  case "update":
    await update()
    break
  case "docs":
    await docs()
    break
  default:
    console.log(help)
    process.exit(command ? 1 : 0)
}
