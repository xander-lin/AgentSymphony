export interface LaunchTerminalRequest {
  conversationId: string
  sessionId: string
  title: string
  directory?: string
}

export interface TerminalWindowRecord {
  conversationId: string
  sessionId: string
  title: string
  pid: number
  launchedAt: string
  reused: boolean
}

export interface TerminalLauncher {
  launch(request: LaunchTerminalRequest): Promise<TerminalWindowRecord>
}
