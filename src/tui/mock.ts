import type { TuiController } from "./controller.ts"

export class MockTuiController implements TuiController {
  readonly prompts: string[] = []
  readonly variants: Array<string | undefined> = []
  rejectOnNext: string | undefined

  async injectPrompt(text: string, options: { variant?: string } = {}): Promise<void> {
    if (this.rejectOnNext !== undefined) {
      const reason = this.rejectOnNext
      this.rejectOnNext = undefined
      throw new Error(reason)
    }
    this.prompts.push(text)
    this.variants.push(options.variant)
  }
}
