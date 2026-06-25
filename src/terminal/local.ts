import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { delimiter, join } from "node:path"
import type { LaunchTerminalRequest, TerminalLauncher, TerminalWindowRecord } from "./launcher.ts"
import { FileTerminalWindowStore } from "./file-store.ts"
import type { TerminalWindowStore } from "./store.ts"

type TerminalCommand = (request: LaunchTerminalRequest) => { command: string; args: string[] }

export class LocalTerminalLauncher implements TerminalLauncher {
  constructor(
    rootDirectory: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly store: TerminalWindowStore = new FileTerminalWindowStore(rootDirectory),
  ) {}

  async launch(request: LaunchTerminalRequest): Promise<TerminalWindowRecord> {
    const existing = await this.store.get(request.conversationId)
    if (existing && isProcessAlive(existing.pid)) return { ...existing, reused: true }
    if (existing) await this.store.delete(request.conversationId)

    const terminal = await this.resolveTerminal(request)
    const child = spawn(terminal.command, terminal.args, {
      cwd: request.directory,
      detached: true,
      stdio: "ignore",
    })
    if (!child.pid) throw new Error("Terminal process did not report a pid")
    child.unref()

    const record: TerminalWindowRecord = {
      conversationId: request.conversationId,
      sessionId: request.sessionId,
      title: request.title,
      pid: child.pid,
      launchedAt: new Date().toISOString(),
      reused: false,
    }
    await this.store.set(record)
    return record
  }

  private async resolveTerminal(request: LaunchTerminalRequest): Promise<{ command: string; args: string[] }> {
    const configured = this.env.AGENTSYMPHONY_TERMINAL
    if (configured) return buildConfiguredTerminal(configured, request)

    for (const candidate of terminalCandidates) {
      const terminal = candidate(request)
      if (await isExecutableOnPath(terminal.command, this.env.PATH)) return terminal
    }

    throw new Error(
      "No supported terminal emulator found. Set AGENTSYMPHONY_TERMINAL, for example: AGENTSYMPHONY_TERMINAL='ghostty --title {title} -e {command}',",
    )
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const terminalCandidates: TerminalCommand[] = [
  (request) => ({ command: "xdg-terminal-exec", args: opencodeTuiCommand(request) }),
  (request) => ({ command: "ghostty", args: ["--title", request.title, "-e", ...opencodeTuiCommand(request)] }),
  (request) => ({ command: "kitty", args: ["--title", request.title, ...opencodeTuiCommand(request)] }),
  (request) => ({ command: "wezterm", args: ["start", "--cwd", request.directory ?? process.cwd(), "--", ...opencodeTuiCommand(request)] }),
  (request) => ({ command: "alacritty", args: ["--title", request.title, "-e", ...opencodeTuiCommand(request)] }),
  (request) => ({ command: "gnome-terminal", args: ["--title", request.title, "--", ...opencodeTuiCommand(request)] }),
  (request) => ({ command: "konsole", args: ["--new-tab", "--workdir", request.directory ?? process.cwd(), "-p", `tabtitle=${request.title}`, "-e", ...opencodeTuiCommand(request)] }),
  (request) => ({ command: "xfce4-terminal", args: ["--title", request.title, "--command", opencodeTuiCommand(request).map(shellQuote).join(" ")] }),
]

function opencodeTuiCommand(request: LaunchTerminalRequest): string[] {
  const args = ["opencode", "--session", request.sessionId]
  if (request.directory) args.push(request.directory)
  return args
}

function buildConfiguredTerminal(template: string, request: LaunchTerminalRequest): { command: string; args: string[] } {
  const parts = splitCommand(template).map((part) =>
    part
      .replaceAll("{sessionId}", request.sessionId)
      .replaceAll("{title}", request.title)
      .replaceAll("{directory}", request.directory ?? process.cwd())
      .replaceAll("{command}", opencodeTuiCommand(request).map(shellQuote).join(" ")),
  )
  const [command, ...args] = parts
  if (!command) throw new Error("AGENTSYMPHONY_TERMINAL cannot be empty")
  return { command, args }
}

function splitCommand(input: string): string[] {
  const matches = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
  return matches.map((match) => match.replace(/^['"]|['"]$/g, ""))
}

async function isExecutableOnPath(command: string, pathValue: string | undefined): Promise<boolean> {
  if (command.includes("/")) return canAccess(command)
  for (const segment of (pathValue ?? "").split(delimiter)) {
    if (!segment) continue
    if (await canAccess(join(segment, command))) return true
  }
  return false
}

async function canAccess(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
