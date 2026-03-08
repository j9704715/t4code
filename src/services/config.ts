import { Config, Effect, Layer, Schema, ServiceMap } from "effect"

const Port = Schema.Int.pipe(Schema.brand("Port"))
type Port = typeof Port.Type

export class AppConfig extends ServiceMap.Service<
  AppConfig,
  {
    readonly port: Port
    readonly t3Bin: string
  }
>()("@t4code/AppConfig") {
  static readonly layer = Layer.effect(AppConfig)(
    Effect.gen(function* () {
      return yield* Config.all({
        port: Config.schema(Port, "T4CODE_PORT").pipe(Config.withDefault(() => Port.makeUnsafe(3773))),
        t3Bin: Config.string("T4CODE_T3_BIN").pipe(Config.withDefault(() => "t3")),
      })
    }),
  ).pipe(Layer.orDie)
}
