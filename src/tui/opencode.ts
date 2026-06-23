import type { TuiController } from "./controller.ts"

interface OpenCodeTuiClient {
  tui?: {
    appendPrompt(input: { body: { text: string } }): Promise<unknown>
    submitPrompt(): Promise<unknown>
  }
}

export class OpenCodeTuiController implements TuiController {
  constructor(private readonly client: OpenCodeTuiClient) {}

  async injectPrompt(text: string): Promise<void> {
    if (!this.client.tui) throw new Error("OpenCode client does not expose TUI controls")
    await this.client.tui.appendPrompt({ body: { text } })
    await this.client.tui.submitPrompt()
  }
}
