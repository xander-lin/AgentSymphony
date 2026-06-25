import { readdir, readFile } from "node:fs/promises"

export async function findOpenCodePidsForSession(sessionId: string): Promise<number[]> {
  const pids: number[] = []
  let entries: string[]
  try {
    entries = await readdir("/proc")
  } catch {
    return pids
  }
  for (const entry of entries) {
    const pid = Number(entry)
    if (!Number.isInteger(pid) || pid <= 0) continue
    try {
      const cmdline = await readFile(`/proc/${pid}/cmdline`, "utf8")
      const args = cmdline.split("\0").filter(Boolean)
      if (args.some((arg) => arg.includes("opencode")) && args.includes(sessionId)) {
        pids.push(pid)
      }
    } catch {
      // process may have exited between readdir and readFile
    }
  }
  return pids
}

export async function findChildPids(parentPid: number): Promise<number[]> {
  const pids: number[] = []
  let entries: string[]
  try {
    entries = await readdir("/proc")
  } catch {
    return pids
  }
  for (const entry of entries) {
    const pid = Number(entry)
    if (!Number.isInteger(pid) || pid <= 0) continue
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8")
      const match = stat.match(/^\d+\s+\([^)]*\)\s+\w\s+(\d+)/)
      if (match && Number(match[1]) === parentPid) {
        pids.push(pid)
      }
    } catch {
      // process may have exited
    }
  }
  return pids
}

export async function killProcessesGracefully(pids: number[], { timeoutMs = 5000 }: { timeoutMs?: number } = {}): Promise<void> {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM")
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined
      if (code === "ESRCH" || code === "EPERM") continue
      throw error
    }
  }

  const deadline = Date.now() + timeoutMs
  const remaining = new Set(pids)
  while (remaining.size > 0 && Date.now() < deadline) {
    for (const pid of [...remaining]) {
      try {
        process.kill(pid, 0)
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined
        if (code === "ESRCH") remaining.delete(pid)
      }
    }
    if (remaining.size === 0) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  for (const pid of remaining) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // best-effort
    }
  }
}

export function killKittyParent(pid: number): void {
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    // best-effort
  }
}
