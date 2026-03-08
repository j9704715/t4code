import { Duration, Effect, Layer, Schedule, ServiceMap } from "effect"
import { BinaryNotFound, CommandFailed } from "./errors.js"
import { parseURL, renderQR, trim } from "../qr.js"
import { spawnString } from "./process.js"

export function parseFirstIpv4(value: string) {
  const match = value.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)
  return match?.[0]
}

export class Tailscale extends ServiceMap.Service<
  Tailscale,
  {
    readonly ensure: (append: (line: string) => void) => Effect.Effect<string, BinaryNotFound | CommandFailed | Error>
  }
>()("@t4code/Tailscale") {
  static readonly layer = Layer.effect(Tailscale)(
    Effect.sync(() => {
      const runString = (bin: string, args: string[]) => spawnString(bin, args)

      const readTailnetIp = (bin: string) =>
        runString(bin, ["ip", "-4"]).pipe(
          Effect.map((output) => parseFirstIpv4(output)),
          Effect.flatMap((ip) =>
            ip
              ? Effect.succeed(ip)
              : Effect.fail(
                  new CommandFailed({
                    command: "tailscale ip -4",
                    message: "No Tailnet IPv4 address is available yet.",
                  }),
                ),
          ),
        )

      const waitForConnection = (bin: string) =>
        readTailnetIp(bin).pipe(
          Effect.timeoutOrElse({
            duration: Duration.seconds(2),
            onTimeout: () =>
              Effect.fail(
                new CommandFailed({
                  command: "tailscale ip -4",
                  message: "Timed out waiting for Tailscale to report an IPv4 address.",
                }),
              ),
          }),
        )

      const retryPolicy = Schedule.spaced(Duration.millis(250)).pipe(Schedule.both(Schedule.recurs(80)))

      const ensure = Effect.fn("Tailscale.ensure")(function* (append: (line: string) => void) {
        const bin = Bun.which("tailscale")
        if (!bin) return yield* new BinaryNotFound({ binary: "tailscale" })

        append("Checking Tailscale connection...\n")

        const initial = yield* readTailnetIp(bin).pipe(Effect.option)
        if (initial._tag === "Some") {
          append(`Tailscale connected on ${initial.value}\n`)
          return initial.value
        }

        append("Tailscale is not connected. Starting login flow...\n")
        const login = yield* runString(bin, ["up", "--qr"]).pipe(
          Effect.timeoutOrElse({
            duration: Duration.seconds(60),
            onTimeout: () => Effect.succeed(""),
          }),
          Effect.orElseSucceed(() => ""),
        )

        const loginUrl = parseURL(login)
        if (loginUrl) {
          append(`Open this URL to finish Tailscale login: ${loginUrl}\n`)
          append(renderQR(loginUrl) + "\n")
        } else if (login.trim()) {
          append(trim(login, 4000) + "\n")
        }

        const tailnetIp = yield* Effect.retryOrElse(waitForConnection(bin), retryPolicy, () =>
          Effect.fail(
            new CommandFailed({
              command: "tailscale up --qr",
              message: "Timed out waiting for Tailscale to connect.",
            }),
          ),
        )

        append(`Tailnet connected on ${tailnetIp}\n`)
        return tailnetIp
      })

      return {
        ensure,
      }
    }),
  )
}
