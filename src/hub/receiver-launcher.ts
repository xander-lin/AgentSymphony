import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import type { AgentSymphonyHub, HubInstance } from "./types.ts"

type SpawnReceiver = (directory: string, title: string | undefined, prompt: string) => { pid?: number; unref(): void }
type ListSessions = () => Promise<OpenCodeSession[]>

export interface OpenCodeSession {
  id: string
  directory: string
  title: string
  time_created: number
  time_updated: number
}

export interface LaunchHubReceiverInput {
  hub: AgentSymphonyHub
  directory: string
  title?: string
  prompt?: string
  timeoutMs?: number
  pollIntervalMs?: number
  beforeInstances?: HubInstance[]
  beforeSessions?: OpenCodeSession[]
  spawnReceiver?: SpawnReceiver
  listSessions?: ListSessions
}

export interface LaunchedHubReceiver {
  instance: HubInstance
  pid: number
  prompt: string
  sessionId?: string
}

export async function launchHubReceiver(input: LaunchHubReceiverInput): Promise<LaunchedHubReceiver> {
  const before = new Set((input.beforeInstances ?? await input.hub.listInstances()).map((instance) => instance.id))
  const listSessions = input.listSessions ?? listOpenCodeSessions
  const beforeSessions = new Set((input.beforeSessions ?? await listSessions()).map((session) => session.id))
  const prompt = input.prompt ?? "AgentSymphony bootstrap registration. Reply exactly: AGENTSYMPHONY_RECEIVER_READY"
  const child = (input.spawnReceiver ?? spawnKittyReceiver)(input.directory, input.title, prompt)
  if (!child.pid) throw new Error("OpenCode receiver process did not report a pid")
  child.unref()

  const timeoutAt = Date.now() + (input.timeoutMs ?? 30_000)
  const pollIntervalMs = input.pollIntervalMs ?? 500
  while (Date.now() < timeoutAt) {
    const instances = await input.hub.listInstances()
    const candidates = instances.filter((instance) => !before.has(instance.id) && instance.directory === input.directory)
    candidates.sort((left, right) => right.registeredAt.localeCompare(left.registeredAt))
    const [instance] = candidates
    if (instance) {
      const session = await findNewSession(listSessions, beforeSessions, input.directory)
      return { instance, pid: child.pid, prompt, sessionId: session?.id }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  throw new Error("Timed out waiting for launched OpenCode receiver to register with AgentSymphony hub")
}

function spawnKittyReceiver(directory: string, title: string | undefined, prompt: string): { pid?: number; unref(): void } {
  const args = ["--detach", "--working-directory", directory]
  if (title) args.push("--title", title)
  args.push("opencode", "--prompt", prompt)
  return spawn("kitty", args, { cwd: directory, detached: true, stdio: "ignore" })
}

async function findNewSession(listSessions: ListSessions, beforeSessions: Set<string>, directory: string): Promise<OpenCodeSession | undefined> {
  const sessions = await listSessions()
  return sessions
    .filter((session) => !beforeSessions.has(session.id) && session.directory === directory)
    .sort((left, right) => right.time_created - left.time_created)[0]
}

export async function listOpenCodeSessions(databasePath = join(homedir(), ".local/share/opencode/opencode.db")): Promise<OpenCodeSession[]> {
  const child = spawn("sqlite3", ["-json", databasePath, "select id, directory, title, time_created, time_updated from session order by time_created desc limit 200"], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))

  const code = await new Promise<number | null>((resolve) => child.on("close", resolve))
  if (code !== 0) throw new Error(`sqlite3 failed while reading OpenCode sessions: ${Buffer.concat(stderr).toString("utf8")}`)
  const text = Buffer.concat(stdout).toString("utf8").trim()
  if (!text) return []
  return JSON.parse(text) as OpenCodeSession[]
}
