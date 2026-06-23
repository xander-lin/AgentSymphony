import type { TuiController } from "./controller.ts"

interface OpenCodeTuiClient {
  session?: {
    promptAsync(input: { path: { id: string }; body: { parts: Array<{ type: "text"; text: string }> }; query?: { directory?: string } }): Promise<unknown>
  }
}

export class OpenCodeTuiController implements TuiController {
  constructor(private readonly client: OpenCodeTuiClient, private readonly getSessionId: () => string | undefined, private readonly directory: string) {}

  async injectPrompt(text: string): Promise<void> {
    if (!this.client.session) throw new Error("OpenCode client does not expose session controls")
    const sessionId = this.getSessionId()
    if (!sessionId) throw new Error("OpenCode session id is not available for prompt injection")
    await this.client.session.promptAsync({
      path: { id: sessionId },
      query: { directory: this.directory },
      body: { parts: [{ type: "text", text }] },
    })
  }
}
