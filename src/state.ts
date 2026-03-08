import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

export type Phase = "welcome" | "running" | "done" | "error" | "install"
export type Step = "idle" | "tailscale" | "codex" | "t3" | "remote"
export type MissingBinary = "" | "tailscale" | "codex" | "t3"

export const phase = Atom.make<Phase>("welcome")
export const step = Atom.make<Step>("idle")
export const log = Atom.make("")
export const url = Atom.make("")
export const error = Atom.make("")
export const missingBinary = Atom.make<MissingBinary>("")

export const registry = AtomRegistry.make()
