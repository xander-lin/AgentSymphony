import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const CONFIG_PATH = join(homedir(), ".config", "opencode", "agentsymphony", "config.json")

export async function resolveHubUrl(): Promise<string> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8")
    const parsed = JSON.parse(raw) as { hubUrl?: string }
    if (parsed.hubUrl) return parsed.hubUrl
  } catch {
    // fall through to env/default
  }
  return process.env.AGENTSYMPHONY_HUB_URL ?? "http://127.0.0.1:4777"
}
