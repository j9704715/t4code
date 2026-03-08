import { Duration, Effect, Layer, Schedule, Scope, ServiceMap } from "effect"
import { AppConfig } from "./config.js"
import { BinaryNotFound, CommandFailed, HealthCheckFailed } from "./errors.js"
import { spawnInScope, spawnString, streamToAppender, type RunningProcess } from "./process.js"
import { formatCodexCliUpgradeMessage, isCodexCliVersionSupported, parseCodexCliVersion } from "../codexCliVersion.js"
import { trim } from "../qr.js"

export interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

export interface T3LaunchCommand {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly label: string
}

function nonEmptyTrimmed(value: string | undefined) {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function detailFromResult(result: CommandResult & { readonly timedOut?: boolean }) {
  if (result.timedOut) return "Timed out while running command."
  const stderr = nonEmptyTrimmed(result.stderr)
  if (stderr) return stderr
  const stdout = nonEmptyTrimmed(result.stdout)
  if (stdout) return stdout
  if (result.code !== 0) return `Command exited with code ${result.code}.`
  return undefined
}

function extractAuthBoolean(value: unknown): boolean | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractAuthBoolean(entry)
      if (nested !== undefined) return nested
    }
    return undefined
  }

  if (!value || typeof value !== "object") return undefined

  const record = value as Record<string, unknown>
  for (const key of ["authenticated", "isAuthenticated", "loggedIn", "isLoggedIn"] as const) {
    if (typeof record[key] === "boolean") return record[key]
  }
  for (const key of ["auth", "status", "session", "account"] as const) {
    const nested = extractAuthBoolean(record[key])
    if (nested !== undefined) return nested
  }
  return undefined
}

export function parseAuthStatusFromOutput(result: CommandResult) {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase()

  if (
    lowerOutput.includes("not logged in") ||
    lowerOutput.includes("login required") ||
    lowerOutput.includes("authentication required") ||
    lowerOutput.includes("run `codex login`") ||
    lowerOutput.includes("run codex login")
  ) {
    return {
      ok: false as const,
      message: "Codex CLI is not authenticated. Run `codex login` and retry.",
    }
  }

  const trimmed = result.stdout.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const authenticated = extractAuthBoolean(JSON.parse(trimmed))
      if (authenticated === true) return { ok: true as const }
      if (authenticated === false) {
        return {
          ok: false as const,
          message: "Codex CLI is not authenticated. Run `codex login` and retry.",
        }
      }
    } catch {
      return {
        ok: result.code === 0,
        ...(result.code === 0
          ? {}
          : {
              message: detailFromResult(result) ?? "Could not verify Codex authentication status.",
            }),
      }
    }
  }

  if (result.code === 0) return { ok: true as const }

  return {
    ok: false as const,
    message: detailFromResult(result) ?? "Could not verify Codex authentication status.",
  }
}

export function buildT3Args(host: string, port: number) {
  return ["--mode", "web", "--host", host, "--port", String(port), "--no-browser"]
}

export function resolveT3LaunchCommand(
  configuredBin: string,
  which: (command: string) => string | null | undefined = Bun.which,
): T3LaunchCommand | null {
  const trimmed = configuredBin.trim()
  if (trimmed.length === 0) return null

  const isExplicitPath =
    trimmed.includes("/") || trimmed.includes("\\") || trimmed.startsWith(".") || trimmed.startsWith("~")

  if (isExplicitPath) {
    return {
      command: trimmed,
      args: [],
      label: trimmed,
    }
  }

  const direct = which(trimmed)
  if (direct) {
    return {
      command: direct,
      args: [],
      label: trimmed,
    }
  }

  if (trimmed !== "t3") return null

  const fallbackLaunchers: ReadonlyArray<T3LaunchCommand> = [
    { command: "bunx", args: ["t3"], label: "bunx t3" },
    { command: "pnpm", args: ["dlx", "t3"], label: "pnpm dlx t3" },
    { command: "yarn", args: ["dlx", "t3"], label: "yarn dlx t3" },
    { command: "npx", args: ["-y", "t3"], label: "npx -y t3" },
  ]

  for (const launcher of fallbackLaunchers) {
    if (!which(launcher.command)) continue
    return launcher
  }

  return null
}

export class T3 extends ServiceMap.Service<
  T3,
  {
    readonly ensureCodexReady: (
      append: (line: string) => void,
    ) => Effect.Effect<void, BinaryNotFound | CommandFailed | Error>
    readonly start: (
      host: string,
      port: number,
      append: (line: string) => void,
    ) => Effect.Effect<RunningProcess | undefined, BinaryNotFound | CommandFailed | HealthCheckFailed | Error, never>
  }
>()("@t4code/T3") {
  static readonly layer = Layer.effect(T3)(
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const config = yield* AppConfig

      const runCapture = (bin: string, args: string[]) =>
        spawnString(bin, args).pipe(
          Effect.map((output) => ({
            stdout: output,
            stderr: "",
            code: 0,
          })),
          Effect.catch((error) =>
            Effect.succeed({
              stdout: "",
              stderr: error instanceof Error ? error.message : String(error),
              code: 1,
            }),
          ),
        )

      const ensureCodexReady = (append: (line: string) => void) =>
        Effect.gen(function* () {
          const codexBin = Bun.which("codex")
          if (!codexBin) return yield* new BinaryNotFound({ binary: "codex" })

          append("Checking Codex CLI...\n")
          const versionResult = yield* runCapture(codexBin, ["--version"])
          if (versionResult.code !== 0) {
            return yield* new CommandFailed({
              command: "codex --version",
              message: detailFromResult(versionResult) ?? "Failed to run Codex CLI.",
            })
          }

          const version = parseCodexCliVersion(`${versionResult.stdout}\n${versionResult.stderr}`)
          if (version && !isCodexCliVersionSupported(version)) {
            return yield* new CommandFailed({
              command: "codex --version",
              message: formatCodexCliUpgradeMessage(version),
            })
          }

          const authResult = yield* runCapture(codexBin, ["login", "status"])
          const auth = parseAuthStatusFromOutput(authResult)
          if (!auth.ok) {
            const message = auth.message ?? "Could not verify Codex authentication status."
            return yield* new CommandFailed({
              command: "codex login status",
              message,
            })
          }

          append("Codex CLI is ready.\n")
        })

      const start = (host: string, port: number, append: (line: string) => void) =>
        Effect.gen(function* () {
          const url = `http://${host}:${port}`

          const alreadyHealthy = yield* Effect.tryPromise({
            try: () => fetch(url, { redirect: "manual" }).then((response) => response.ok || response.status === 302),
            catch: () => false as const,
          }).pipe(Effect.catch(() => Effect.succeed(false)))

          if (alreadyHealthy) {
            append(`Reusing existing T3 server on ${url}\n`)
            return undefined
          }

          const launch = resolveT3LaunchCommand(config.t3Bin)
          if (!launch) {
            return yield* new BinaryNotFound({ binary: "t3" })
          }

          append(`Starting T3 Code on ${url} using ${launch.label}...\n`)

          const env: Record<string, string> = {}
          for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined) env[key] = value
          }

          const handle = yield* spawnInScope(launch.command, [...launch.args, ...buildT3Args(host, port)], {
            cwd: process.env.T4CODE_ORIGINAL_CWD ?? process.cwd(),
            env,
            extendEnv: false,
          }).pipe(Scope.provide(scope))

          let buffer = ""
          yield* Effect.forkIn(
            streamToAppender(handle.all, (text) => {
              buffer = trim(buffer + text, 8000)
              append(text)
            }),
            scope,
          )

          const checkHealth = Effect.tryPromise({
            try: () =>
              fetch(url, { redirect: "manual" }).then((response) => {
                if (!response.ok && response.status !== 302) throw new Error("not ready")
              }),
            catch: () => new HealthCheckFailed({ message: "T3 Code is not ready yet." }),
          }).pipe(
            Effect.timeoutOrElse({
              duration: Duration.seconds(2),
              onTimeout: () => Effect.fail(new HealthCheckFailed({ message: "T3 readiness check timed out." })),
            }),
          )

          const healthCheckPolicy = Schedule.spaced(Duration.millis(250)).pipe(Schedule.both(Schedule.recurs(80)))
          const waitForExit = handle.exitCode.pipe(
            Effect.flatMap((code) =>
              Effect.fail(
                new HealthCheckFailed({
                  message:
                    `T3 Code exited before becoming reachable (code=${String(code)}).\n` +
                    (buffer.length > 0 ? buffer : "No process output was captured."),
                }),
              ),
            ),
          )

          yield* Effect.raceFirst(
            Effect.retryOrElse(checkHealth, healthCheckPolicy, () =>
              Effect.gen(function* () {
                yield* handle.kill().pipe(Effect.ignore)
                return yield* new HealthCheckFailed({
                  message: `T3 Code did not become reachable.\n${buffer}`,
                })
              }),
            ),
            waitForExit,
          )

          append("T3 Code is reachable.\n")
          return handle
        })

      return {
        ensureCodexReady,
        start,
      }
    }),
  )
}
