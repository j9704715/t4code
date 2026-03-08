import { expect, test } from "bun:test"
import {
  compareCodexCliVersions,
  formatCodexCliUpgradeMessage,
  isCodexCliVersionSupported,
  parseCodexCliVersion,
} from "./codexCliVersion.js"

test("parses codex versions from CLI output", () => {
  expect(parseCodexCliVersion("codex 0.37.1")).toBe("0.37.1")
  expect(parseCodexCliVersion("codex v0.38.0-beta.1")).toBe("0.38.0-beta.1")
  expect(parseCodexCliVersion("missing")).toBeNull()
})

test("compares versions correctly", () => {
  expect(compareCodexCliVersions("0.37.0", "0.37.0")).toBe(0)
  expect(compareCodexCliVersions("0.38.0", "0.37.0")).toBeGreaterThan(0)
  expect(compareCodexCliVersions("0.37.0-beta.1", "0.37.0")).toBeLessThan(0)
})

test("checks minimum version support", () => {
  expect(isCodexCliVersionSupported("0.37.0")).toBe(true)
  expect(isCodexCliVersionSupported("0.36.9")).toBe(false)
  expect(formatCodexCliUpgradeMessage("0.36.9")).toContain("0.37.0")
})
