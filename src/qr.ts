import QRCode from "qrcode"

const ANSI_ESCAPE_RE = new RegExp(
  `[${String.fromCharCode(27)}${String.fromCharCode(155)}][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]`,
  "g",
)

export function trim(value: string, max: number) {
  if (value.length <= max) return value
  return value.slice(value.length - max)
}

export function stripTerminalControl(value: string) {
  return value.replace(ANSI_ESCAPE_RE, "").replace(/\r/g, "")
}

export function parseURL(value: string) {
  const stripped = stripTerminalControl(value)
  return stripped.match(/https?:\/\/[^\s)]+/)?.[0]
}

function qrCell(data: ReadonlyArray<number | boolean> | Uint8Array, size: number, x: number, y: number) {
  if (x < 0 || y < 0 || x >= size || y >= size) return false
  return Boolean(data[y * size + x])
}

export function renderQR(value: string) {
  const result = QRCode.create(value, { errorCorrectionLevel: "L" })
  const size = result.modules.size
  const data = result.modules.data as ReadonlyArray<number | boolean> | Uint8Array
  const border = 2
  const lines: string[] = []

  for (let y = -border; y < size + border; y += 2) {
    let line = ""
    for (let x = -border; x < size + border; x += 1) {
      const top = qrCell(data, size, x, y)
      const bottom = qrCell(data, size, x, y + 1)
      if (top && bottom) line += "█"
      else if (top) line += "▀"
      else if (bottom) line += "▄"
      else line += " "
    }
    lines.push(line)
  }

  return lines.join("\n")
}

async function runWithStdin(command: string, args: string[], text: string) {
  try {
    const proc = Bun.spawn([command, ...args], {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    })
    proc.stdin.write(text)
    proc.stdin.end()
    return (await proc.exited) === 0
  } catch {
    return false
  }
}

export async function copyToClipboard(text: string) {
  if (process.platform === "darwin") {
    if (!(await runWithStdin("pbcopy", [], text))) throw new Error("Failed to copy to clipboard")
    return
  }

  if (process.platform === "win32") {
    if (!(await runWithStdin("clip", [], text))) throw new Error("Failed to copy to clipboard")
    return
  }

  const linuxTools = [
    { command: "wl-copy", args: [] },
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] },
  ]

  for (const tool of linuxTools) {
    if (!Bun.which(tool.command)) continue
    if (await runWithStdin(tool.command, tool.args, text)) return
  }

  throw new Error("No supported clipboard tool found")
}

async function run(command: string, args: string[]) {
  try {
    const proc = Bun.spawn([command, ...args], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
    return (await proc.exited) === 0
  } catch {
    return false
  }
}

export async function openInBrowser(targetUrl: string) {
  if (process.platform === "darwin") {
    if (!(await run("open", [targetUrl]))) throw new Error("Failed to open browser")
    return
  }

  if (process.platform === "win32") {
    if (!(await run("cmd", ["/c", "start", "", targetUrl]))) throw new Error("Failed to open browser")
    return
  }

  if (!(await run("xdg-open", [targetUrl]))) throw new Error("Failed to open browser")
}
