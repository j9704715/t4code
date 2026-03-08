/** @jsxImportSource @opentui/solid */

import "@opentui/solid/preload"

import { render } from "@opentui/solid"
import { RegistryContext } from "@effect/atom-solid/RegistryContext"
import { App } from "./app.js"
import { registry } from "./state.js"

render(
  () => (
    <RegistryContext.Provider value={registry}>
      <App />
    </RegistryContext.Provider>
  ),
  {
    targetFps: 60,
    exitOnCtrlC: false,
  },
)
