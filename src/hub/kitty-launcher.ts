import type { LaunchHubReceiverInput, LaunchedHubReceiver, ResumeHubReceiverInput } from "./receiver-launcher.ts"
import { launchHubReceiver, resumeHubReceiver } from "./receiver-launcher.ts"
import { findChildPids, findOpenCodePidsForSession } from "./process.ts"
import type { HubReceiverLauncher } from "./launcher-types.ts"

export class KittyReceiverLauncher implements HubReceiverLauncher {
  launch(input: LaunchHubReceiverInput): Promise<LaunchedHubReceiver> {
    return launchHubReceiver(input)
  }

  resume(input: ResumeHubReceiverInput): Promise<LaunchedHubReceiver> {
    return resumeHubReceiver(input)
  }

  async getChildPids(sessionId: string): Promise<number[]> {
    const pids = await findOpenCodePidsForSession(sessionId)
    const all: number[] = [...pids]
    for (const pid of pids) {
      const children = await findChildPids(pid)
      all.push(...children)
    }
    return all
  }
}
