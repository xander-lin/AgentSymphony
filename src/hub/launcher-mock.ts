import { createId } from "../shared/id.ts"
import type { HubReceiverLauncher } from "./launcher-types.ts"
import type { LaunchHubReceiverInput, LaunchedHubReceiver, ResumeHubReceiverInput } from "./receiver-launcher.ts"

export class MockReceiverLauncher implements HubReceiverLauncher {
  launched: LaunchedHubReceiver[] = []
  resumed: LaunchedHubReceiver[] = []
  launchErrors: Error[] = []
  resumeErrors: Error[] = []

  async launch(input: LaunchHubReceiverInput): Promise<LaunchedHubReceiver> {
    const error = this.launchErrors.shift()
    if (error) throw error
    const result: LaunchedHubReceiver = {
      instance: {
        id: createId("inst"),
        name: "mock-receiver",
        directory: input.directory,
        registeredAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      },
      pid: 99999,
      prompt: "mock prompt",
      sessionId: createId("ses"),
      model: input.model,
    }
    this.launched.push(result)
    return result
  }

  async resume(input: ResumeHubReceiverInput): Promise<LaunchedHubReceiver> {
    const error = this.resumeErrors.shift()
    if (error) throw error
    const result: LaunchedHubReceiver = {
      instance: {
        id: createId("inst"),
        name: "mock-resumed",
        directory: input.directory,
        registeredAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      },
      pid: 88888,
      prompt: "mock resume prompt",
      sessionId: input.sessionId,
      variant: input.variant,
      reused: false,
    }
    this.resumed.push(result)
    return result
  }

  reset(): void {
    this.launched = []
    this.resumed = []
    this.launchErrors = []
    this.resumeErrors = []
  }

  async getChildPids(_sessionId: string): Promise<number[]> {
    return []
  }
}
