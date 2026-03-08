import { expect, test } from "bun:test"
import { buildT3Args, parseAuthStatusFromOutput, resolveT3LaunchCommand } from "./t3.js"

test("builds T3 web mode args for a tailnet host", () => {
  expect(buildT3Args("100.64.0.1", 3773)).toEqual([
    "--mode",
    "web",
    "--host",
    "100.64.0.1",
    "--port",
    "3773",
    "--no-browser",
  ])
})

test("detects unauthenticated codex status output", () => {
  const result = parseAuthStatusFromOutput({
    stdout: "",
    stderr: "Not logged in. Run codex login.",
    code: 1,
  })

  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.message).toContain("codex login")
  }
})

test("accepts successful codex status output", () => {
  const result = parseAuthStatusFromOutput({
    stdout: '{"authenticated":true}',
    stderr: "",
    code: 0,
  })

  expect(result.ok).toBe(true)
})

test("prefers a directly installed t3 binary", () => {
  const launch = resolveT3LaunchCommand("t3", (command) => (command === "t3" ? "/usr/bin/t3" : null))

  expect(launch).toEqual({
    command: "/usr/bin/t3",
    args: [],
    label: "t3",
  })
})

test("falls back to bunx when t3 is not installed", () => {
  const launch = resolveT3LaunchCommand("t3", (command) => (command === "bunx" ? "/usr/bin/bunx" : null))

  expect(launch).toEqual({
    command: "bunx",
    args: ["t3"],
    label: "bunx t3",
  })
})

test("supports pnpm, yarn, and npx fallback order", () => {
  const pnpmLaunch = resolveT3LaunchCommand("t3", (command) => (command === "pnpm" ? "/usr/bin/pnpm" : null))
  const yarnLaunch = resolveT3LaunchCommand("t3", (command) =>
    command === "yarn" ? "/usr/bin/yarn" : command === "pnpm" ? null : null,
  )
  const npxLaunch = resolveT3LaunchCommand("t3", (command) => (command === "npx" ? "/usr/bin/npx" : null))

  expect(pnpmLaunch).toEqual({
    command: "pnpm",
    args: ["dlx", "t3"],
    label: "pnpm dlx t3",
  })
  expect(yarnLaunch).toEqual({
    command: "yarn",
    args: ["dlx", "t3"],
    label: "yarn dlx t3",
  })
  expect(npxLaunch).toEqual({
    command: "npx",
    args: ["-y", "t3"],
    label: "npx -y t3",
  })
})
