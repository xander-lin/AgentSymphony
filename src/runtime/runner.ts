export interface RunRequest {
  message: string
  sessionId?: string
  title?: string
  agent?: string
  model?: string
  directory?: string
}

export interface RunResult {
  output: string
  sessionId?: string
}

export interface OpenCodeRunner {
  run(request: RunRequest): Promise<RunResult>
}
