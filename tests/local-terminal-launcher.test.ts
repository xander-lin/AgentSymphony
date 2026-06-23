import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { LocalTerminalLauncher } from "../src/terminal/local.ts"

describe("LocalTerminalLauncher", () => {
  it("reuses a persisted live terminal window across launcher instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentsymphony-local-terminal-"))
    const terminalScript = join(directory, "fake-terminal.sh")
    const launchesFile = join(directory, "launches.txt")

    await writeFile(
      terminalScript,
      `#!/bin/sh\nprintf 'launch\\n' >> '${launchesFile}'\nsleep 30\n`,
      "utf8",
    )
    await chmod(terminalScript, 0o755)

    let firstPid: number | undefined
    try {
      const request = {
        conversationId: "conv_reuse",
        sessionId: "ses_reuse",
        title: "reuse",
        directory,
      }
      const env = { ...process.env, AGENTSYMPHONY_TERMINAL: `${terminalScript} {command}` }

      const first = await new LocalTerminalLauncher(directory, env).launch(request)
      firstPid = first.pid
      const second = await new LocalTerminalLauncher(directory, env).launch(request)

      await waitForLaunchFile(launchesFile)
      const launches = await readFile(launchesFile, "utf8")

      expect(first.reused).toBe(false)
      expect(second.reused).toBe(true)
      expect(second.pid).toBe(first.pid)
      expect(launches.trim().split("\n")).toHaveLength(1)
    } finally {
      if (firstPid) killIfAlive(firstPid)
      await rm(directory, { recursive: true, force: true })
    }
  })
})

async function waitForLaunchFile(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await readFile(filePath, "utf8")
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw new Error(`Launch file was not created: ${filePath}`)
}

function killIfAlive(pid: number): void {
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    // The process may have exited before cleanup.
  }
}
