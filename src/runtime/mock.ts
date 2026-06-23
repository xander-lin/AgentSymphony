import type { OpenCodeRunner, RunRequest, RunResult } from "./runner.ts"
import { createId } from "../shared/id.ts"

export class MockOpenCodeRunner implements OpenCodeRunner {
  async run(request: RunRequest): Promise<RunResult> {
    return {
      output: `mock child response: ${request.message}`,
      sessionId: request.sessionId ?? createId("session"),
    }
  }
}
