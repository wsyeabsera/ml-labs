#!/usr/bin/env bun
import React from "react"
import { render } from "ink"
import { App } from "./App"

const { waitUntilExit } = render(<App />, { exitOnCtrlC: true })
await waitUntilExit()
process.exit(0)
