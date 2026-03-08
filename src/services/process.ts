import { Effect } from "effect"

export interface RunningProcess {
  readonly pid: number
  readonly all: ReadableStream<Uint8Array>
  readonly exitCode: Effect.Effect<number, Error>
  readonly isRunning: Effect.Effect<boolean>
  readonly kill: (signal?: NodeJS.Signals | number) => Effect.Effect<void>
}

export interface CommandOptions {
  readonly cwd?: string
  readonly env?: Record<string, string>
  readonly extendEnv?: boolean
}

function resolveEnv(options?: CommandOptions) {
  if (!options?.env) return options?.extendEnv === false ? {} : process.env
  return options.extendEnv === false ? options.env : { ...process.env, ...options.env }
}

function mergeReadableStreams(...streams: Array<ReadableStream<Uint8Array> | null | undefined>) {
  const activeStreams = streams.filter((stream) => stream != null)

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (activeStreams.length === 0) {
        controller.close()
        return
      }

      let remaining = activeStreams.length

      const closeIfDone = () => {
        remaining -= 1
        if (remaining === 0) controller.close()
      }

      for (const stream of activeStreams) {
        const reader = stream.getReader()
        const pump = (): void => {
          void reader.read().then(
            ({ done, value }) => {
              if (done) {
                reader.releaseLock()
                closeIfDone()
                return
              }

              if (value) controller.enqueue(value)
              pump()
            },
            (cause) => controller.error(cause),
          )
        }

        pump()
      }
    },
  })
}

function spawnSubprocess(bin: string, args: string[], options?: CommandOptions) {
  return Bun.spawn({
    cmd: [bin, ...args],
    cwd: options?.cwd,
    env: resolveEnv(options),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
}

function toRunningProcess(proc: Bun.Subprocess<"ignore", "pipe", "pipe">): RunningProcess {
  return {
    pid: proc.pid,
    all: mergeReadableStreams(proc.stdout, proc.stderr),
    exitCode: Effect.tryPromise({
      try: () => proc.exited,
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
    isRunning: Effect.sync(() => proc.exitCode === null),
    kill: (signal) =>
      Effect.sync(() => {
        if (proc.exitCode === null) proc.kill(signal)
      }),
  }
}

async function readStreamAsString(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let result = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) result += decoder.decode(value, { stream: true })
  }

  result += decoder.decode()
  reader.releaseLock()
  return result
}

const spawnManaged = (bin: string, args: string[], options?: CommandOptions) =>
  Effect.acquireRelease(
    Effect.sync(() => toRunningProcess(spawnSubprocess(bin, args, options))),
    (handle) => handle.kill("SIGKILL").pipe(Effect.andThen(handle.exitCode), Effect.ignore),
  )

export const spawnInScope = (bin: string, args: string[], options?: CommandOptions) => spawnManaged(bin, args, options)

export const spawnExitCode = (bin: string, args: string[], options?: CommandOptions) =>
  Effect.scoped(spawnManaged(bin, args, options).pipe(Effect.flatMap((handle) => handle.exitCode)))

export const spawnString = (bin: string, args: string[], options?: CommandOptions) =>
  Effect.scoped(
    spawnManaged(bin, args, options).pipe(
      Effect.flatMap((handle) =>
        Effect.tryPromise({
          try: () => readStreamAsString(handle.all),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }),
      ),
    ),
  )

export const streamToAppender = (stream: ReadableStream<Uint8Array>, append: (line: string) => void) =>
  Effect.tryPromise({
    try: async () => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = value ? decoder.decode(value, { stream: true }) : ""
          if (text) append(text)
        }

        const tail = decoder.decode()
        if (tail) append(tail)
      } finally {
        reader.releaseLock()
      }
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
