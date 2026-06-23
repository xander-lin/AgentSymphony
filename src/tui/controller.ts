export interface TuiController {
  injectPrompt(text: string): Promise<void>
}
