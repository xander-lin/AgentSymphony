import type { TuiController } from "./controller.ts"

export class MockTuiController implements TuiController {
  readonly prompts: string[] = []
  readonly variants: Array<string | undefined> = []

  async injectPrompt(text: string, options: { variant?: string } = {}): Promise<void> {
    this.prompts.push(text)
    this.variants.push(options.variant)
  }
}
