import type { LaunchTerminalRequest, TerminalLauncher, TerminalWindowRecord } from "./launcher.ts"

export class MockTerminalLauncher implements TerminalLauncher {
  readonly launches: LaunchTerminalRequest[] = []
  private readonly windows = new Map<string, TerminalWindowRecord>()

  async launch(request: LaunchTerminalRequest): Promise<TerminalWindowRecord> {
    const existing = this.windows.get(request.conversationId)
    if (existing) return { ...existing, reused: true }

    this.launches.push(request)
    const record: TerminalWindowRecord = {
      conversationId: request.conversationId,
      sessionId: request.sessionId,
      title: request.title,
      pid: this.launches.length,
      launchedAt: new Date().toISOString(),
      reused: false,
    }
    this.windows.set(request.conversationId, record)
    return record
  }
}
