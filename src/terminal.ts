import fs from "node:fs"

const RESET_SEQUENCES = [
  "\u001b[0m",
  "\u001b[?25h",
  "\u001b[?1000l",
  "\u001b[?1002l",
  "\u001b[?1003l",
  "\u001b[?1004l",
  "\u001b[?1006l",
  "\u001b[?2004l",
  "\u001b[?2026l",
  "\u001b[?2027l",
  "\u001b[?2031l",
  "\u001b[?1049l",
].join("")

let restored = false

export function restoreTerminal() {
  if (restored) return
  restored = true

  try {
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false)
    }
  } catch {}

  try {
    if (typeof process.stdout.fd === "number") {
      fs.writeSync(process.stdout.fd, RESET_SEQUENCES)
    }
  } catch {}

  try {
    process.stdin.pause()
  } catch {}

  try {
    if (typeof process.stdin.unref === "function") {
      process.stdin.unref()
    }
  } catch {}
}

export function exitProcess(code = 0) {
  restoreTerminal()
  process.exit(code)
}
