/** @jsxImportSource @opentui/solid */

import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useAtomSet, useAtomValue } from "@effect/atom-solid/Hooks"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import type { JSX } from "solid-js"
import { copyToClipboard, openInBrowser, renderQR } from "./qr.js"
import { error, log, missingBinary, phase, step, type MissingBinary, type Step, url } from "./state.js"
import { flowFn, restartFlow, signalExit, waitForFlowStop } from "./flow.js"
import { exitProcess } from "./terminal.js"

const palette = {
  bg: "#000000",
  panel: "#070707",
  panelSoft: "#111111",
  line: "#1b1b1b",
  text: "#f5f5f5",
  muted: "#b6b6b6",
  dim: "#737373",
  accent: "#d9d9d9",
  info: "#8eb8ff",
  success: "#98ddb5",
  warning: "#f3d08b",
  error: "#ff9a9a",
}

const stageOrder: ReadonlyArray<Step> = ["tailscale", "codex", "t3", "remote"]
const wordmark = `███ █ ▄ ███ ███ ██▄ ███
▀█▀ █ █ █▀▀ █▀█ █▀█ █▀▀
 █  ███ █   █ █ █ █ ██
 █    █ ███ ███ ██▀ ███`

function installGuide(binary: MissingBinary) {
  if (binary === "tailscale") {
    if (process.platform === "darwin") {
      return {
        title: "Install Tailscale",
        docsUrl: "https://tailscale.com/download",
        command: "brew install --cask tailscale-app",
        hint: "Sign in to Tailscale, then retry.",
      }
    }
    if (process.platform === "win32") {
      return {
        title: "Install Tailscale",
        docsUrl: "https://tailscale.com/download/windows",
        command: "winget install --id tailscale.tailscale --exact",
        hint: "Sign in to Tailscale, then retry.",
      }
    }
    return {
      title: "Install Tailscale",
      docsUrl: "https://tailscale.com/download/linux",
      command: "curl -fsSL https://tailscale.com/install.sh | sh",
      hint: "Sign in to Tailscale, then retry.",
    }
  }

  if (binary === "codex") {
    return {
      title: "Install Codex CLI",
      docsUrl: "https://github.com/openai/codex",
      command: "Install Codex CLI, then run: codex login",
      hint: "T3 uses Codex for actual coding sessions.",
    }
  }

  return {
    title: "Install T3 Code",
    docsUrl: "https://github.com/pingdotgg/t3code",
    command: "t4code can launch via bunx, pnpm dlx, yarn dlx, npx, or a global t3 binary",
    hint: "If t3 is broken locally, fix that install and retry.",
  }
}

function Panel(props: { readonly children: JSX.Element; readonly tone?: "primary" | "soft"; readonly gap?: number }) {
  return (
    <box
      flexDirection="column"
      backgroundColor={props.tone === "soft" ? palette.panelSoft : palette.panel}
      borderStyle="single"
      borderColor={palette.line}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      gap={props.gap ?? 1}
    >
      {props.children}
    </box>
  )
}

function ActionRow(props: { readonly items: ReadonlyArray<{ readonly key: string; readonly label: string }> }) {
  return (
    <box flexDirection="row" gap={2}>
      {props.items.map((item) => (
        <box flexDirection="row" gap={1}>
          <text fg={palette.accent}>{item.key}</text>
          <text fg={palette.dim}>{item.label}</text>
        </box>
      ))}
    </box>
  )
}

function StatusRow(props: {
  readonly stageOrder: ReadonlyArray<Step>
  readonly stageColors: (candidate: Step) => { readonly fg: string; readonly bg: string; readonly glyph: string }
}) {
  return (
    <box flexDirection="row" gap={1}>
      {props.stageOrder.map((candidate, index) => {
        const tone = props.stageColors(candidate)
        return (
          <>
            {index > 0 ? <text fg={palette.dim}>·</text> : null}
            <text fg={tone.fg}>{tone.glyph}</text>
            <text fg={palette.muted}>{candidate}</text>
          </>
        )
      })}
    </box>
  )
}

function Header(props: { readonly subtitle?: string }) {
  return (
    <>
      <text fg={palette.text}>{wordmark}</text>
      <Show when={props.subtitle}>
        <text fg={palette.muted}>{props.subtitle}</text>
      </Show>
    </>
  )
}

export function App() {
  const dims = useTerminalDimensions()
  const currentPhase = useAtomValue(phase)
  const currentStep = useAtomValue(step)
  const logs = useAtomValue(log)
  const remoteUrl = useAtomValue(url)
  const errorMessage = useAtomValue(error)
  const currentMissingBinary = useAtomValue(missingBinary)

  const setPhase = useAtomSet(phase)
  const setError = useAtomSet(error)
  const setLog = useAtomSet(log)
  const setUrl = useAtomSet(url)
  const setMissingBinary = useAtomSet(missingBinary)
  const triggerFlow = useAtomSet(flowFn)

  const [spinnerFrame, setSpinnerFrame] = createSignal(0)
  const [flashedKey, setFlashedKey] = createSignal("")

  const spinner = createMemo(() => ["|", "/", "-", "\\"][spinnerFrame() % 4] ?? "|")
  const recentLog = createMemo(() =>
    logs()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-6)
      .join("\n"),
  )
  const qrCode = createMemo(() => {
    const nextUrl = remoteUrl()
    if (!nextUrl) return ""
    try {
      return renderQR(nextUrl)
    } catch {
      return ""
    }
  })
  const guide = createMemo(() => installGuide(currentMissingBinary() || "tailscale"))
  const panelWidth = createMemo(() => {
    const width = Number(dims().width ?? 80)
    const safeWidth = Number.isFinite(width) && width > 0 ? width : 80
    return Math.max(60, Math.min(92, safeWidth - 4))
  })

  const flash = (key: string) => {
    setFlashedKey(key)
    setTimeout(() => setFlashedKey(""), 1200)
  }

  const quit = () => {
    signalExit()
    const fallback = setTimeout(() => exitProcess(0), 5000)
    void waitForFlowStop().finally(() => {
      clearTimeout(fallback)
      exitProcess(0)
    })
  }

  const start = async () => {
    if (currentPhase() === "done") {
      await restartFlow()
    }

    setError("")
    setLog("")
    setUrl("")
    setMissingBinary("")
    setPhase("running")
    triggerFlow(undefined)
  }

  const failedStep = createMemo<Step | null>(() => {
    const missing = currentMissingBinary()
    if (missing === "tailscale") return "tailscale"
    if (missing === "codex") return "codex"
    if (missing === "t3") return "t3"
    return currentStep() === "idle" ? null : currentStep()
  })

  const stageState = (candidate: Step) => {
    if (currentPhase() === "welcome") return "pending"
    if (currentPhase() === "done") return "done"

    const active = currentPhase() === "install" ? failedStep() : currentStep()
    const activeIndex = active ? stageOrder.indexOf(active) : -1
    const candidateIndex = stageOrder.indexOf(candidate)

    if (currentPhase() === "install" || currentPhase() === "error") {
      if (active === candidate) return "error"
      return activeIndex > candidateIndex ? "done" : "pending"
    }

    if (currentPhase() === "running" && active === candidate) return "active"
    return activeIndex > candidateIndex ? "done" : "pending"
  }

  const stageColors = (candidate: Step) => {
    const state = stageState(candidate)
    if (state === "done") return { fg: palette.success, bg: palette.panelSoft, glyph: "[x]" }
    if (state === "active") return { fg: palette.info, bg: palette.panelSoft, glyph: `[${spinner()}]` }
    if (state === "error") return { fg: palette.error, bg: palette.panelSoft, glyph: "[!]" }
    return { fg: palette.dim, bg: palette.panelSoft, glyph: "[ ]" }
  }

  useKeyboard((event) => {
    if (event.name === "escape" || event.name === "q" || (event.ctrl && event.name === "c")) {
      quit()
      return
    }

    if (currentPhase() === "welcome" && event.name === "return") {
      event.preventDefault()
      void start()
      return
    }

    if (
      (currentPhase() === "error" || currentPhase() === "install") &&
      (event.name === "return" || event.name === "r")
    ) {
      event.preventDefault()
      void start()
      return
    }

    if (currentPhase() === "done" && (event.name === "c" || event.name === "o" || event.name === "r")) {
      event.preventDefault()
      if (event.name === "c") {
        void copyToClipboard(remoteUrl())
          .then(() => flash("c"))
          .catch(() => {})
        return
      }
      if (event.name === "o") {
        void openInBrowser(remoteUrl())
          .then(() => flash("o"))
          .catch(() => {})
        return
      }
      void start()
    }
  })

  onMount(() => {
    const timer = setInterval(() => setSpinnerFrame((value) => value + 1), 120)
    onCleanup(() => clearInterval(timer))
    setPhase("welcome")
  })

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      backgroundColor={palette.bg}
      justifyContent="flex-start"
      alignItems="center"
      paddingTop={1}
      paddingBottom={1}
    >
      <box flexDirection="column" width={panelWidth()} gap={1}>
        <Show when={currentPhase() === "welcome"}>
          <Panel>
            <Header subtitle="Guided remote launcher for T3 Code." />
            <StatusRow stageOrder={stageOrder} stageColors={stageColors} />
            <text fg={palette.text}>This run will:</text>
            <text fg={palette.muted}>1. verify Tailscale connectivity</text>
            <text fg={palette.muted}>2. verify Codex CLI availability and auth</text>
            <text fg={palette.muted}>3. launch T3 in web mode</text>
            <text fg={palette.muted}>4. present a tailnet URL and QR code</text>
            <ActionRow
              items={[
                { key: "enter", label: "start" },
                { key: "q", label: "quit" },
              ]}
            />
          </Panel>
        </Show>

        <Show when={currentPhase() === "running"}>
          <Panel>
            <Header />
            <StatusRow stageOrder={stageOrder} stageColors={stageColors} />
            <text fg={palette.info}>{spinner()} Bringing up remote T3 Code...</text>
            <text fg={palette.dim}>Usually this finishes in a few seconds unless T3 itself is broken.</text>
            <Show when={recentLog()}>
              <Panel tone="soft" gap={0}>
                <text fg={palette.muted}>Recent output</text>
                <text fg={palette.text}>{recentLog()}</text>
              </Panel>
            </Show>
            <ActionRow items={[{ key: "q / esc", label: "quit" }]} />
          </Panel>
        </Show>

        <Show when={currentPhase() === "install"}>
          <Panel>
            <Header />
            <StatusRow stageOrder={stageOrder} stageColors={stageColors} />
            <text fg={palette.warning}>{guide().title}</text>
            <text fg={palette.text}>{errorMessage()}</text>
            <Panel tone="soft">
              <text fg={palette.accent}>{guide().command}</text>
              <text fg={palette.dim}>{guide().hint}</text>
              <text fg={palette.dim}>{guide().docsUrl}</text>
            </Panel>
            <ActionRow
              items={[
                { key: "enter / r", label: "retry" },
                { key: "q / esc", label: "quit" },
              ]}
            />
          </Panel>
        </Show>

        <Show when={currentPhase() === "error"}>
          <Panel>
            <Header />
            <StatusRow stageOrder={stageOrder} stageColors={stageColors} />
            <text fg={palette.error}>Startup failed</text>
            <text fg={palette.text}>{errorMessage()}</text>
            <Show when={recentLog()}>
              <Panel tone="soft" gap={0}>
                <text fg={palette.muted}>Recent output</text>
                <text fg={palette.text}>{recentLog()}</text>
              </Panel>
            </Show>
            <ActionRow
              items={[
                { key: "enter / r", label: "retry" },
                { key: "q / esc", label: "quit" },
              ]}
            />
          </Panel>
        </Show>

        <Show when={currentPhase() === "done"}>
          <Panel>
            <Header />
            <StatusRow stageOrder={stageOrder} stageColors={stageColors} />
            <text fg={palette.success}>T3 Code is live on your tailnet.</text>
            <text fg={palette.text}>{remoteUrl()}</text>
            <Show when={qrCode().length > 0}>
              <text fg={palette.muted}>Scan from another tailnet device</text>
              <text fg={palette.text}>{qrCode()}</text>
            </Show>
            <ActionRow
              items={[
                { key: flashedKey() === "c" ? "[c]" : "c", label: "copy url" },
                { key: flashedKey() === "o" ? "[o]" : "o", label: "open url" },
                { key: "r", label: "restart" },
                { key: "q / esc", label: "quit" },
              ]}
            />
          </Panel>
        </Show>
      </box>
    </box>
  )
}
