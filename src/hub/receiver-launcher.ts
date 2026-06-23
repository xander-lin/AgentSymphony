import { spawn } from "node:child_process"
import type { AgentSymphonyHub, HubInstance } from "./types.ts"

type SpawnReceiver = (directory: string, title: string | undefined, prompt: string) => { pid?: number; unref(): void }

export interface LaunchHubReceiverInput {
  hub: AgentSymphonyHub
  directory: string
  title?: string
  prompt?: string
  timeoutMs?: number
  pollIntervalMs?: number
  beforeInstances?: HubInstance[]
  spawnReceiver?: SpawnReceiver
}

export interface LaunchedHubReceiver {
  instance: HubInstance
  pid: number
  prompt: string
}

export async function launchHubReceiver(input: LaunchHubReceiverInput): Promise<LaunchedHubReceiver> {
  const before = new Set((input.beforeInstances ?? await input.hub.listInstances()).map((instance) => instance.id))
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
    if (instance) return { instance, pid: child.pid, prompt }
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
