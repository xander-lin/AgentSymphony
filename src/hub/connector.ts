import type { InstanceIdentity } from "../instance/identity.ts"
import type { TuiController } from "../tui/controller.ts"
import { formatInjectedHubPrompt } from "./prompt.ts"
import type { ReplyContextStore } from "./reply-context.ts"
import type { AgentSymphonyHub, HubInstance } from "./types.ts"

export interface HubConnectorOptions {
  hub: AgentSymphonyHub
  identity: InstanceIdentity | (() => InstanceIdentity | undefined)
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
      const identity = typeof options.identity === "function" ? options.identity() : options.identity
      if (!identity) {
        status = { connected: false, error: "Waiting for OpenCode session identity." }
        return
      }
      const shouldRegister = !status.connected || status.instance.id !== identity.id
      const instance = status.connected
        && !shouldRegister
        ? await options.hub.heartbeat(status.instance.id)
        : await options.hub.registerInstance({
            id: identity.id,
            name: identity.name,
            directory: identity.directory,
          })
      status = { connected: true, instance }
      const messages = await options.hub.pollMessages(instance.id)
      for (const message of messages) {
        const conversation = await options.hub.getConversation(message.conversationId)
        if (!conversation) continue
        const createdByThisInstance = conversation.createdByInstanceId === instance.id
        await options.replyContext.setFromMessage({ message, threadName: conversation.threadName, createdByThisInstance })
        await options.tui.injectPrompt(formatInjectedHubPrompt(message, conversation, createdByThisInstance), { variant: message.variant })
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
