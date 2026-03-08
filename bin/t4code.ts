#!/usr/bin/env bun

import { fileURLToPath } from "node:url"

function printHelp() {
  process.stdout.write(
    `t4code

Usage:
  t4code [--help]

Environment:
  T4CODE_PORT    Port used for the T3 web server (default: 3773)
  T4CODE_T3_BIN  T3 executable to launch (default: t3)
`,
  )
}

const args = process.argv.slice(2)

if (args.includes("--help") || args.includes("-h")) {
  printHelp()
  process.exit(0)
}

const mainPath = fileURLToPath(new URL("../src/main.tsx", import.meta.url).href)
const packageRoot = fileURLToPath(new URL("..", import.meta.url).href)
const child = Bun.spawn({
  cmd: [
    process.execPath,
    "run",
    "--conditions=browser",
    "--preserve-symlinks",
    "--preload",
    "@opentui/solid/preload",
    "--jsx-import-source",
    "@opentui/solid",
    mainPath,
  ],
  cwd: packageRoot,
  env: {
    ...process.env,
    T4CODE_ORIGINAL_CWD: process.cwd(),
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

process.exit(await child.exited)
