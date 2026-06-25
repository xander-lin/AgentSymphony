import type { LaunchHubReceiverInput, LaunchedHubReceiver, ResumeHubReceiverInput } from "./receiver-launcher.ts"
import { launchHubReceiver, resumeHubReceiver } from "./receiver-launcher.ts"
import type { HubReceiverLauncher } from "./launcher-types.ts"

export class KittyReceiverLauncher implements HubReceiverLauncher {
  launch(input: LaunchHubReceiverInput): Promise<LaunchedHubReceiver> {
    return launchHubReceiver(input)
  }

  resume(input: ResumeHubReceiverInput): Promise<LaunchedHubReceiver> {
    return resumeHubReceiver(input)
  }
}
