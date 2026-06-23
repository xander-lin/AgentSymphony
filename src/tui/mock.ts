import type { TuiController } from "./controller.ts"

export class MockTuiController implements TuiController {
  readonly prompts: string[] = []

  async injectPrompt(text: string): Promise<void> {
    this.prompts.push(text)
  }
}
