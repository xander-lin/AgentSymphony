import type { LaunchedHubReceiver, LaunchHubReceiverInput, ResumeHubReceiverInput } from "./receiver-launcher.ts"

export interface HubReceiverLauncher {
  launch(input: LaunchHubReceiverInput): Promise<LaunchedHubReceiver>
  resume(input: ResumeHubReceiverInput): Promise<LaunchedHubReceiver>
}
