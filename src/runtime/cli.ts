import { spawn } from "node:child_process"
import type { OpenCodeRunner, RunRequest, RunResult } from "./runner.ts"

export class CliOpenCodeRunner implements OpenCodeRunner {
  constructor(private readonly command = "opencode") {}

  async run(request: RunRequest): Promise<RunResult> {
    const args = ["run", "--format", "json"]
    if (request.sessionId) args.push("--session", request.sessionId)
    if (request.title) args.push("--title", request.title)
    if (request.agent) args.push("--agent", request.agent)
    if (request.model) args.push("--model", request.model)
    if (request.directory) args.push("--dir", request.directory)
    args.push(request.message)

    const { stdout, stderr } = await runProcess(this.command, args)
    if (stderr.trim().length > 0 && stdout.trim().length === 0) {
      throw new Error(stderr.trim())
    }

    return parseRunOutput(stdout)
  }
}

function runProcess(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(stderr.trim() || `opencode exited with code ${code}`))
    })
  })
}

function parseRunOutput(stdout: string): RunResult {
  let output = ""
  let sessionId: string | undefined

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>
      sessionId = pickSessionId(event) ?? sessionId
      output += pickText(event)
    } catch {
      output += `${trimmed}\n`
    }
  }

  return { output: output.trim(), sessionId }
}

export const parseRunOutputForTest = parseRunOutput

function pickSessionId(event: Record<string, unknown>): string | undefined {
  const candidates = [event.sessionID, event.sessionId, event.session, event.part && typeof event.part === "object" ? (event.part as Record<string, unknown>).sessionID : undefined]
  for (const candidate of candidates) {
    if (typeof candidate === "string") return candidate
    if (candidate && typeof candidate === "object" && "id" in candidate && typeof candidate.id === "string") return candidate.id
  }
  return undefined
}

function pickText(event: Record<string, unknown>): string {
  const part = event.part && typeof event.part === "object" ? (event.part as Record<string, unknown>) : undefined
  const candidates = [event.text, event.content, event.message, part?.text, part?.content, part?.message]
  for (const candidate of candidates) {
    if (typeof candidate === "string") return candidate
    if (candidate && typeof candidate === "object" && "text" in candidate && typeof candidate.text === "string") return candidate.text
    if (candidate && typeof candidate === "object" && "content" in candidate && typeof candidate.content === "string") return candidate.content
  }
  return ""
}
