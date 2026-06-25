import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export interface AgentSymphonyConfig {
  hub?: {
    url?: string
    port?: number
    host?: string
    instanceTtlMs?: number
    messageTtlMs?: number
    store?: string
  }
}

const DEFAULT_PATH = join(homedir(), ".config", "opencode", "agentsymphony", "config.json")

export async function loadConfig(path = DEFAULT_PATH): Promise<AgentSymphonyConfig> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as AgentSymphonyConfig
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined
    if (code === "ENOENT") return {}
    throw error
  }
}

export function resolveHubUrl(config: AgentSymphonyConfig): string {
  if (config.hub?.url) return config.hub.url
  const port = config.hub?.port ?? Number(process.env.AGENTSYMPHONY_HUB_PORT ?? "4777")
  const host = config.hub?.host ?? process.env.AGENTSYMPHONY_HUB_HOST ?? "127.0.0.1"
  return `http://${host}:${port}`
}

export function resolveInstanceTtlMs(config: AgentSymphonyConfig): number {
  return config.hub?.instanceTtlMs ?? Number(process.env.AGENTSYMPHONY_INSTANCE_TTL_MS ?? "3000")
}

export function resolveMessageTtlMs(config: AgentSymphonyConfig): number {
  return config.hub?.messageTtlMs ?? Number(process.env.AGENTSYMPHONY_MESSAGE_TTL_MS ?? "86400000")
}

export function resolveStorePath(config: AgentSymphonyConfig): string | undefined {
  return config.hub?.store ?? process.env.AGENTSYMPHONY_HUB_STORE ?? undefined
}
