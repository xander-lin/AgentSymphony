export interface TuiController {
  injectPrompt(text: string, options?: { variant?: string }): Promise<void>
}
