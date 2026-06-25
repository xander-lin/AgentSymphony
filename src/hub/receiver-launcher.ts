import { spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { FileInstanceIdentityStore, type InstanceIdentityStore } from "../instance/identity.ts"
import type { AgentSymphonyHub, HubInstance } from "./types.ts"
import { findOpenCodePidsForSession, findChildPids, killProcessesGracefully } from "./process.ts"

type SpawnReceiver = (directory: string, title: string | undefined, prompt: string, options?: LaunchModelOptions) => { pid?: number; unref(): void }
type SpawnResumedReceiver = (directory: string, title: string | undefined, sessionId: string, prompt: string, options?: ResumeModelOptions) => { pid?: number; unref(): void }
type IsSessionProcess = (processId: number, sessionId: string) => Promise<boolean>
type ListSessions = () => Promise<OpenCodeSession[]>

const DEFAULT_LAUNCH_PROMPT = "AgentSymphony receiver registration only. Do not list, read, or poll AgentSymphony threads. Do not start shell polling loops. Wait for injected AgentSymphony messages from the hub connector. When you receive an AgentSymphony message, reply to it using agentsymphony_hub_reply."
const DEFAULT_RESUME_PROMPT = "AgentSymphony receiver resume registration only. Do not list, read, or poll AgentSymphony threads. Do not start shell polling loops. Wait for injected AgentSymphony messages from the hub connector. When you receive an AgentSymphony message, reply to it using agentsymphony_hub_reply."

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
  timeoutMs?: number
  model?: string
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
  model?: string
  variant?: string
  reused?: boolean
}

export interface ResumeHubReceiverInput {
  hub: AgentSymphonyHub
  directory: string
  sessionId: string
  processId?: number
  title?: string
  timeoutMs?: number
  variant?: string
  pollIntervalMs?: number
  spawnReceiver?: SpawnResumedReceiver
  isSessionProcess?: IsSessionProcess
  identityStore?: InstanceIdentityStore
}

export async function launchHubReceiver(input: LaunchHubReceiverInput): Promise<LaunchedHubReceiver> {
  const before = new Set((input.beforeInstances ?? await input.hub.listInstances()).map((instance) => instance.id))
  const listSessions = input.listSessions ?? listOpenCodeSessions
  const beforeSessions = new Set((input.beforeSessions ?? await listSessions()).map((session) => session.id))
  const prompt = DEFAULT_LAUNCH_PROMPT
  const child = (input.spawnReceiver ?? spawnKittyReceiver)(input.directory, input.title, prompt, { model: input.model })
  if (!child.pid) throw new Error("OpenCode receiver process did not report a pid")
  child.unref()

  const timeoutAt = Date.now() + (input.timeoutMs ?? 30_000)
  const pollIntervalMs = input.pollIntervalMs ?? 500
  try {
    while (Date.now() < timeoutAt) {
      const instances = await input.hub.listInstances()
      const candidates = instances.filter((instance) => !before.has(instance.id) && instance.directory === input.directory)
      candidates.sort((left, right) => right.registeredAt.localeCompare(left.registeredAt))
      const [instance] = candidates
      if (instance) {
        const session = await tryFindNewSession(listSessions, beforeSessions, input.directory)
        const sessionId = session?.id
        if (sessionId && child.pid) {
          try { await saveReceiverPid(input.directory, sessionId, child.pid) } catch { /* best-effort */ }
        }
        return { instance, pid: child.pid, prompt, sessionId, model: input.model }
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }
  } catch (error) {
    killProcess(child.pid)
    throw error
  }

  killProcess(child.pid)
  throw new Error("Timed out waiting for launched OpenCode receiver to register with AgentSymphony hub")
}

async function saveReceiverPid(directory: string, sessionId: string, pid: number): Promise<void> {
  const path = join(directory, ".agentsymphony", "pids", `session-${sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96)}.json`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({ pid })}\n`, "utf8")
}

export async function loadReceiverPid(directory: string, sessionId: string): Promise<number | undefined> {
  try {
    const raw = await readFile(join(directory, ".agentsymphony", "pids", `session-${sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96)}.json`), "utf8")
    return JSON.parse(raw).pid as number
  } catch {
    return undefined
  }
}

function killProcess(pid: number | undefined): void {
  if (!pid) return
  try { process.kill(pid, "SIGTERM") } catch { /* best-effort */ }
}

export async function resumeHubReceiver(input: ResumeHubReceiverInput): Promise<LaunchedHubReceiver> {
  const identityStore = input.identityStore ?? new FileInstanceIdentityStore()
  const identity = await identityStore.load(input.directory, input.sessionId)
  const prompt = DEFAULT_RESUME_PROMPT

  const oldPids = await findOpenCodePidsForSession(input.sessionId)
  const recordedPid = await loadReceiverPid(input.directory, input.sessionId)
  if (recordedPid !== undefined && !oldPids.includes(recordedPid)) {
    oldPids.push(recordedPid)
    const children = await findChildPids(recordedPid)
    for (const pid of children) {
      if (!oldPids.includes(pid)) oldPids.push(pid)
    }
  }
  if (oldPids.length > 0) {
    await killProcessesGracefully(oldPids)
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const instances = await input.hub.listInstances()
      if (!instances.some((i) => i.id === identity.id)) break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  const child = (input.spawnReceiver ?? spawnKittyResumedReceiver)(input.directory, input.title, input.sessionId, prompt, { variant: input.variant })
  if (!child.pid) throw new Error("OpenCode receiver process did not report a pid")
  child.unref()

  try {
    const instance = await waitForResumedInstance(input.hub, identity.id, input.directory, input.timeoutMs ?? 30_000, input.pollIntervalMs ?? 500)
    try { await saveReceiverPid(input.directory, input.sessionId, child.pid) } catch { /* best-effort */ }
    return { instance, pid: child.pid, prompt, sessionId: input.sessionId, variant: input.variant, reused: false }
  } catch (error) {
    killProcess(child.pid)
    throw error
  }
}

async function waitForResumedInstance(hub: AgentSymphonyHub, instanceId: string, directory: string, timeoutMs: number, pollIntervalMs: number): Promise<HubInstance> {
  const timeoutAt = Date.now() + timeoutMs
  while (Date.now() < timeoutAt) {
    const instances = await hub.listInstances()
    const instance = instances.find((candidate) => candidate.id === instanceId && candidate.directory === directory)
    if (instance) return instance
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  throw new Error(`Timed out waiting for resumed OpenCode instance ${instanceId} to register with AgentSymphony hub`)
}

function spawnKittyReceiver(directory: string, title: string | undefined, prompt: string, options: LaunchModelOptions = {}): { pid?: number; unref(): void } {
  const args = ["--working-directory", directory]
  if (title) args.push("--title", title)
  const launch = buildOpenCodeLaunchArgs({ prompt, model: options.model })
  args.push(...launch.args)
  return spawn("kitty", args, { cwd: directory, detached: true, stdio: "ignore", env: launch.env })
}

function spawnKittyResumedReceiver(directory: string, title: string | undefined, sessionId: string, prompt: string, options: ResumeModelOptions = {}): { pid?: number; unref(): void } {
  const args = ["--working-directory", directory]
  if (title) args.push("--title", title)
  const launch = buildOpenCodeLaunchArgs({ sessionId, prompt, variant: options.variant })
  args.push(...launch.args)
  return spawn("kitty", args, { cwd: directory, detached: true, stdio: "ignore", env: { ...launch.env, AGENTSYMPHONY_RESUME_SESSION_ID: sessionId } })
}

function buildOpenCodeLaunchArgs(input: { sessionId?: string; prompt: string; model?: string; variant?: string }): { args: string[]; env: NodeJS.ProcessEnv } {
  const args = ["opencode"]
  const env = { ...process.env }
  if (input.sessionId) args.push("--session", input.sessionId)
  if (input.model) args.push("--model", input.model)
  args.push("--prompt", input.prompt)
  return { args, env }
}

interface LaunchModelOptions {
  model?: string
}

interface ResumeModelOptions {
  variant?: string
}

async function findNewSession(listSessions: ListSessions, beforeSessions: Set<string>, directory: string): Promise<OpenCodeSession | undefined> {
  const sessions = await listSessions()
  return sessions
    .filter((session) => !beforeSessions.has(session.id) && session.directory === directory)
    .sort((left, right) => right.time_created - left.time_created)[0]
}

async function tryFindNewSession(listSessions: ListSessions, beforeSessions: Set<string>, directory: string): Promise<OpenCodeSession | undefined> {
  try {
    return await findNewSession(listSessions, beforeSessions, directory)
  } catch {
    return undefined
  }
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

export async function isOpenCodeSessionProcess(processId: number, sessionId: string): Promise<boolean> {
  if (!Number.isInteger(processId) || processId <= 0) return false
  try {
    const cmdline = await readFile(`/proc/${processId}/cmdline`, "utf8")
    const args = cmdline.split("\0").filter(Boolean)
    return args.some((arg) => arg.includes("opencode")) && args.includes(sessionId)
  } catch {
    return false
  }
}
