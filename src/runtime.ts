import * as Atom from "effect/unstable/reactivity/Atom"
import { AppConfig } from "./services/config.js"

export const appRuntime = Atom.runtime(AppConfig.layer)
