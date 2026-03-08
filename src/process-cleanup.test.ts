import { expect, test } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { spawnInScope } from "./services/process.js"

test("ChildProcess scope cleanup kills child processes when scope closes", async () => {
  const program = Effect.gen(function* () {
    const scope = yield* Scope.make()

    const proc = yield* spawnInScope("sh", ["-c", "sleep 60"]).pipe(Scope.provide(scope))
    const pid = proc.pid

    expect(yield* proc.isRunning).toBe(true)

    yield* Scope.close(scope, Exit.void)

    const alive = yield* Effect.sync(() => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    })

    expect(alive).toBe(false)
  })

  await Effect.runPromise(Effect.scoped(program))
})
