import { Deferred, Effect, Layer } from "effect"
import { Tailscale } from "./services/tailscale.js"
import { T3 } from "./services/t3.js"
import { appRuntime } from "./runtime.js"
import { registry, phase, step, log, url, error, missingBinary } from "./state.js"
import { BinaryNotFound } from "./services/errors.js"
import { stripTerminalControl, trim } from "./qr.js"
import { AppConfig } from "./services/config.js"
import { exitProcess, restoreTerminal } from "./terminal.js"

function append(line: string) {
  const clean = stripTerminalControl(line)
  if (!clean) return
  registry.update(log, (previous) => trim(previous + clean, 24_000))
}

let exitSignal = Deferred.makeUnsafe<void>()
let exitSignaled = false
let flowRunning = false
let exiting = false
const shutdownWaiters = new Set<() => void>()

function resolveShutdownWaiters() {
  for (const resolve of shutdownWaiters) resolve()
  shutdownWaiters.clear()
}

export function signalExit() {
  if (exitSignaled) return
  exitSignaled = true
  Deferred.doneUnsafe(exitSignal, Effect.succeed(undefined))
}

function resetExitSignal() {
  exitSignal = Deferred.makeUnsafe<void>()
  exitSignaled = false
}

export function waitForFlowStop() {
  if (!flowRunning) return Promise.resolve()
  return new Promise<void>((resolve) => {
    shutdownWaiters.add(resolve)
  })
}

export function restartFlow() {
  if (!flowRunning) {
    resetExitSignal()
    return Promise.resolve()
  }

  signalExit()
  return waitForFlowStop().finally(() => {
    resetExitSignal()
  })
}

export const flowFn = appRuntime.fn<void>()(() =>
  Effect.gen(function* () {
    flowRunning = true

    registry.set(error, "")
    registry.set(url, "")
    registry.set(log, "")
    registry.set(missingBinary, "")

    const config = yield* AppConfig
    const tailscale = yield* Tailscale
    const t3 = yield* T3

    registry.set(step, "tailscale")
    const tailnetIp = yield* tailscale.ensure(append)

    registry.set(step, "codex")
    yield* t3.ensureCodexReady(append)

    registry.set(step, "t3")
    yield* t3.start(tailnetIp, config.port, append)

    registry.set(step, "remote")
    registry.set(url, `http://${tailnetIp}:${config.port}`)
    registry.set(step, "idle")
    registry.set(phase, "done")

    yield* Deferred.await(exitSignal)
  }).pipe(
    Effect.catch((cause) =>
      Effect.sync(() => {
        if ((cause as { readonly _tag?: string })._tag === "BinaryNotFound") {
          const missing = cause as BinaryNotFound
          registry.set(error, `${missing.binary} is not installed`)
          if (missing.binary === "tailscale" || missing.binary === "codex" || missing.binary === "t3") {
            registry.set(missingBinary, missing.binary)
          }
          registry.set(phase, "install")
          return
        }

        registry.set(
          error,
          "message" in (cause as object) ? String((cause as { message: string }).message) : String(cause),
        )
        registry.set(phase, "error")
      }),
    ),
    Effect.provide(Layer.mergeAll(Tailscale.layer, T3.layer)),
    Effect.ensuring(
      Effect.sync(() => {
        flowRunning = false
        resolveShutdownWaiters()
      }),
    ),
  ),
)

function gracefulProcessExit() {
  if (exiting) return
  exiting = true
  signalExit()
  const fallback = setTimeout(() => exitProcess(0), 5000)
  void waitForFlowStop().finally(() => {
    clearTimeout(fallback)
    exitProcess(0)
  })
}

process.on("SIGINT", gracefulProcessExit)
process.on("SIGTERM", gracefulProcessExit)
process.on("SIGHUP", gracefulProcessExit)
process.on("SIGQUIT", gracefulProcessExit)
process.on("exit", restoreTerminal)
process.on("uncaughtException", (cause) => {
  restoreTerminal()
  console.error(cause)
  process.exit(1)
})
process.on("unhandledRejection", (cause) => {
  restoreTerminal()
  console.error(cause)
  process.exit(1)
})
process.stdin.on("end", gracefulProcessExit)
process.stdin.on("close", gracefulProcessExit)
