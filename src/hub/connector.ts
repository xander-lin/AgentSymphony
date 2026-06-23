import type { InstanceIdentity } from "../instance/identity.ts"
import type { TuiController } from "../tui/controller.ts"
import { formatInjectedHubPrompt } from "./prompt.ts"
import type { ReplyContextStore } from "./reply-context.ts"
import type { AgentSymphonyHub, HubInstance } from "./types.ts"

export interface HubConnectorOptions {
  hub: AgentSymphonyHub
  identity: InstanceIdentity
  tui: TuiController
  replyContext: ReplyContextStore
  pollIntervalMs?: number
}

export interface HubConnectorHandle {
  getStatus(): HubConnectorStatus
  stop(): void
}

export type HubConnectorStatus =
  | { connected: true; instance: HubInstance; error?: undefined }
  | { connected: false; instance?: undefined; error?: string }

export function startHubConnector(options: HubConnectorOptions): HubConnectorHandle {
  const intervalMs = options.pollIntervalMs ?? 1000
  let stopped = false
  let polling = false
  let status: HubConnectorStatus = { connected: false }

  const poll = async () => {
    if (stopped || polling) return
    polling = true
    try {
      const instance = status.connected
        ? await options.hub.heartbeat(status.instance.id)
        : await options.hub.registerInstance({
            id: options.identity.id,
            name: options.identity.name,
            directory: options.identity.directory,
          })
      status = { connected: true, instance }
      const messages = await options.hub.pollMessages(instance.id)
      for (const message of messages) {
        const conversation = await options.hub.getConversation(message.conversationId)
        if (!conversation) continue
        const createdByThisInstance = conversation.createdByInstanceId === instance.id
        await options.replyContext.setFromMessage({ message, threadName: conversation.threadName, createdByThisInstance })
        await options.tui.injectPrompt(formatInjectedHubPrompt(message, conversation, createdByThisInstance))
        await options.hub.acknowledgeMessage(message.id)
      }
    } catch (error) {
      status = { connected: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      polling = false
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), intervalMs)

  return {
    getStatus() {
      return status
    },
    stop() {
      stopped = true
      clearInterval(timer)
    },
  }
}
