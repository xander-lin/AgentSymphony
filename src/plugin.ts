import { type Plugin, tool } from "@opencode-ai/plugin"
import { startHubConnector } from "./hub/connector.ts"
import { HttpAgentSymphonyHubClient } from "./hub/http-client.ts"
import { launchHubReceiver, resumeHubReceiver, loadReceiverPid } from "./hub/receiver-launcher.ts"
import { FileReplyContextStore } from "./hub/reply-context.ts"
import type { HubMessage } from "./hub/types.ts"
import type { ReplyContext } from "./hub/reply-context.ts"
import { FileInstanceIdentityStore, type InstanceIdentity } from "./instance/identity.ts"
import { OpenCodeTuiController } from "./tui/opencode.ts"
import { buildTeamSystemGuidance } from "./plugin-guidance.ts"
import { loadModelCatalog } from "./model-catalog.ts"
import { defaultThreadName, deleteVisibleTeammate, describeConversation, findSessionIdForInstance, findVisibleConversationByThread, findVisibleTeammateByInstanceId, respondHub, sendHubMessageOrOfflineNotice, sendInitialHubMessage } from "./plugin-utils.ts"
import { findOpenCodePidsForSession, findChildPids, killKittyParent, killProcessesGracefully } from "./hub/process.ts"

export const AgentSymphonyPlugin: Plugin = async ({ directory, client }) => {
  const identityStore = new FileInstanceIdentityStore()
  let identity: InstanceIdentity | undefined
  let currentSessionId: string | undefined
  let identityBindingQueue = Promise.resolve()
  let launchQueue = Promise.resolve()
  const bootstrapSessionId = process.env.AGENTSYMPHONY_RESUME_SESSION_ID
  delete process.env.AGENTSYMPHONY_RESUME_SESSION_ID
  const bindSessionIdentity = async (sessionId: string): Promise<InstanceIdentity> => {
    const bind = async () => {
      currentSessionId = sessionId
      identity = await identityStore.load(directory, sessionId, identity)
      return identity
    }
    const next = identityBindingQueue.then(bind, bind)
    identityBindingQueue = next.then(() => undefined, () => undefined)
    return next
  }
  if (bootstrapSessionId) await bindSessionIdentity(bootstrapSessionId)
  const hub = new HttpAgentSymphonyHubClient()
  const replyContext = new FileReplyContextStore(directory, () => identity?.id)
  const hubConnector = startHubConnector({ hub, identity: () => identity, tui: new OpenCodeTuiController(client, () => currentSessionId, directory), replyContext })
  let teamSystemGuidance: string | undefined
  const enqueueLaunch = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = launchQueue.then(operation, operation)
    launchQueue = next.then(() => undefined, () => undefined)
    return next
  }

  return {
    tool: {
      agentsymphony_hub_status: tool({
        description: "Diagnostics: check whether this OpenCode session is registered with the AgentSymphony hub. Not used for sending or receiving messages.",
        args: {},
        async execute() {
          const hubState = hubConnector.getStatus()
          return respondHub({ hub, directory, identity, type: "hub.status", summary: hubState.connected ? `Connected to AgentSymphony hub as ${hubState.instance.id}.` : "AgentSymphony hub is not connected.", data: {
            connected: hubState.connected,
            instance: hubState.connected ? hubState.instance : undefined,
            identity,
            error: hubState.connected ? undefined : hubState.error,
          } })
        },
      }),
      agentsymphony_hub_system_status: tool({
        description: "Team status: inspect live teammates, visible threads, queued messages, offline teammates, and resume/cleanup warnings for this session.",
        args: {},
        async execute() {
          const hubState = hubConnector.getStatus()
          const snapshot = await hub.getMonitorSnapshot()
          const currentIdentity = identity
          const relatedInstanceIds = new Set<string>(currentIdentity ? [currentIdentity.id] : [])
          if (currentIdentity) {
            for (const conversation of snapshot.conversations) {
              if (conversation.parentInstanceId !== currentIdentity.id && conversation.targetInstanceId !== currentIdentity.id) continue
              relatedInstanceIds.add(conversation.parentInstanceId)
              relatedInstanceIds.add(conversation.targetInstanceId)
            }
          }
          const relatedInstances = currentIdentity ? snapshot.instances.filter((instance) => relatedInstanceIds.has(instance.id)) : []
          const knownInstances = currentIdentity ? relatedInstances.filter((instance) => instance.id !== currentIdentity.id) : []
          const liveInstances = knownInstances.filter((instance) => instance.online !== false)
          const liveRelatedInstances = relatedInstances.filter((instance) => instance.online !== false)
          const liveInstanceIds = new Set(liveRelatedInstances.map((instance) => instance.id))
          const instancesById = new Map(snapshot.instances.map((instance) => [instance.id, instance]))
          const visibleThreads = currentIdentity
            ? snapshot.conversations
                .filter((conversation) => conversation.parentInstanceId === currentIdentity.id || conversation.targetInstanceId === currentIdentity.id)
                .map((conversation) => {
                  const targetInstanceId = conversation.parentInstanceId === currentIdentity.id ? conversation.targetInstanceId : conversation.parentInstanceId
                  const messages = snapshot.messages.filter((message) => message.conversationId === conversation.id)
                  return {
                    threadName: conversation.threadName,
                    title: conversation.title,
                    conversationId: conversation.id,
                    createdByThisInstance: conversation.createdByInstanceId === currentIdentity.id,
                    targetInstanceId,
                    targetOnline: liveInstanceIds.has(targetInstanceId),
                    messageCount: messages.length,
                    queuedCount: messages.filter((message) => message.status === "queued").length,
                    updatedAt: conversation.updatedAt,
                  }
                })
            : []
          const visibleConversationIds = new Set(visibleThreads.map((thread) => thread.conversationId))
          const visibleMessages = currentIdentity ? snapshot.messages.filter((message) => visibleConversationIds.has(message.conversationId)) : []
          const offlineTargets = []
          for (const instance of knownInstances.filter((candidate) => candidate.online === false)) {
            const relatedThreads = snapshot.conversations
              .filter((conversation) => (conversation.parentInstanceId === instance.id || conversation.targetInstanceId === instance.id) && visibleConversationIds.has(conversation.id))
              .map((conversation) => {
                const senderInstanceId = conversation.parentInstanceId === instance.id ? conversation.targetInstanceId : conversation.parentInstanceId
                const messages = snapshot.messages.filter((message) => message.conversationId === conversation.id)
                return {
                  threadName: conversation.threadName,
                  title: conversation.title,
                  conversationId: conversation.id,
                  senderInstanceId,
                  senderName: instancesById.get(senderInstanceId)?.name,
                  senderOnline: liveInstanceIds.has(senderInstanceId),
                  messageCount: messages.length,
                  queuedCount: messages.filter((message) => message.status === "queued").length,
                  updatedAt: conversation.updatedAt,
                }
              })
              .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            offlineTargets.push({
              instance,
              relatedThreads,
              resume: { tool: "agentsymphony_hub_resume_receiver", sessionId: await findSessionIdForInstance(directory, instance.id) },
            })
          }
          return respondHub({ hub, directory, identity: currentIdentity, type: "hub.system_status", summary: `Team has ${liveInstances.length} live teammates, ${knownInstances.length} known teammates, ${visibleThreads.length} visible threads, and ${visibleMessages.length} messages.`, data: {
            current: {
              connected: hubState.connected,
              instance: hubState.connected ? hubState.instance : undefined,
              identity: currentIdentity,
              error: hubState.connected ? undefined : hubState.error,
            },
            counts: {
              liveInstances: liveInstances.length,
              knownInstances: knownInstances.length,
              threads: visibleThreads.length,
              visibleThreads: visibleThreads.length,
              offlineTargets: offlineTargets.length,
              messages: visibleMessages.length,
              queuedMessages: snapshot.messages.filter((message) => message.status === "queued").length,
            },
            liveInstances,
            knownInstances,
            visibleThreads,
            offlineTargets,
            suggestedTools: {
              sendExistingThread: "agentsymphony_hub_send_thread",
              replyInboundThread: "agentsymphony_hub_reply",
              readThreadHistory: "agentsymphony_hub_read_thread",
              launchReceiver: "agentsymphony_hub_launch_receiver",
              resumeReceiver: "agentsymphony_hub_resume_receiver",
              deleteOfflineTeammate: "agentsymphony_hub_delete_teammate",
            },
          } })
        },
      }),
      agentsymphony_hub_list_instances: tool({
        description: "Diagnostics: list live OpenCode instances currently registered with the hub. Prefer system_status for workflow decisions and offline warnings.",
        args: {},
        async execute() {
          const instances = await hub.listInstances()
          return respondHub({ hub, directory, identity, type: "hub.instances", summary: `Listed ${instances.length} AgentSymphony hub instances.`, data: { instances } })
        },
      }),
      agentsymphony_hub_launch_receiver: tool({
        description: "Team start: launch a new OpenCode teammate and automatically create its thread. No separate create step, target id, or conversation description is needed.",
        args: {
          title: tool.schema.string().optional().describe("Window title only; not a teammate/task description."),
          prompt: tool.schema.string().optional().describe("Optional first task message for the teammate. It is delivered through the hub after registration, not as raw startup input."),
          model: tool.schema.string().optional().describe("Initial provider/model id selected from the current opencode config or AgentSymphony model catalog. Only launch may set model."),
          threadName: tool.schema.string().optional().describe("Stable short name for later send_thread calls. If omitted, AgentSymphony generates one."),
          timeoutMs: tool.schema.number().optional().describe("Maximum milliseconds to wait for receiver registration."),
        },
        async execute(args) {
          if (!identity) throw new Error("AgentSymphony hub is waiting for the current OpenCode session identity.")
          const currentIdentity = identity
          return enqueueLaunch(async () => {
            const existingConversations = await hub.listConversationsForInstance(currentIdentity.id)
            const liveInstances = await hub.listInstances()
            const liveTeammateIds = new Set(liveInstances.map((i) => i.id))
            for (const conv of existingConversations) {
              const mateId = conv.parentInstanceId === currentIdentity.id ? conv.targetInstanceId : conv.parentInstanceId
              if (liveTeammateIds.has(mateId)) {
                throw new Error(`Teammate ${mateId} is already live on thread ${conv.threadName}. Delete or resume it before launching a new one.`)
              }
            }
            const result = await launchHubReceiver({
              hub,
              directory,
              title: args.title,
              model: args.model,
              timeoutMs: args.timeoutMs,
            })
            const threadName = args.threadName ?? defaultThreadName(result.sessionId ?? result.instance.id)
            const conversation = await hub.createConversation({
              parentInstanceId: currentIdentity.id,
              targetInstanceId: result.instance.id,
              title: threadName,
              threadName,
            })
            let initialDelivery: HubMessage | undefined
            try {
              initialDelivery = await sendInitialHubMessage({ hub, fromInstanceId: currentIdentity.id, conversation, content: args.prompt })
            } catch {
              await hub.archiveThread(threadName)
              throw new Error(`Failed to deliver initial message to receiver; thread ${threadName} has been cleaned up.`)
            }
            return respondHub({ hub, directory, identity: currentIdentity, type: "hub.receiver.launched", summary: `Launched receiver ${result.instance.id} and connected thread ${conversation.threadName}${initialDelivery ? ", then queued the initial message" : ""}.`, data: {
              ...result,
              thread: describeConversation(conversation),
              initialMessage: initialDelivery,
            } })
          })
        },
      }),
      agentsymphony_hub_resume_receiver: tool({
        description: "Team restart: restart an offline teammate by OpenCode session id. Kills any lingering processes for the session, then spawns a fresh receiver. Use when a warning says an offline teammate is still needed.",
        args: {
          sessionId: tool.schema.string().describe("OpenCode session id to restart."),
          processId: tool.schema.number().optional().describe("Deprecated. Process lookup is now automatic via session id scan."),
          title: tool.schema.string().optional().describe("Window title only."),
          prompt: tool.schema.string().optional().describe("Optional first task message after resume. It is delivered through the hub, not as raw resume input."),
          variant: tool.schema.string().optional().describe("Variant for the resume prompt only. Resume does not change the session model."),
          timeoutMs: tool.schema.number().optional().describe("Maximum milliseconds to wait for receiver registration."),
        },
        async execute(args) {
          if (!identity) throw new Error("AgentSymphony hub is waiting for the current OpenCode session identity.")
          const currentIdentity = identity
          return enqueueLaunch(async () => {
            const result = await resumeHubReceiver({
              hub,
              directory,
              sessionId: args.sessionId,
              processId: args.processId,
              title: args.title,
              variant: args.variant,
              timeoutMs: args.timeoutMs,
            })
            const conversation = identity ? await findVisibleTeammateByInstanceId(hub, identity.id, result.instance.id) : undefined
            const initialDelivery = conversation && identity ? await sendInitialHubMessage({ hub, fromInstanceId: identity.id, conversation, content: args.prompt, variant: args.variant }) : undefined
            return respondHub({ hub, directory, identity, type: "hub.receiver.resumed", summary: `Resumed receiver ${result.instance.id}${initialDelivery ? ", then queued the initial message" : ""}.`, data: { ...result, initialMessage: initialDelivery } })
        })
        },
      }),
      agentsymphony_hub_send_thread: tool({
        description: "Team send: send work or follow-up context to an existing teammate thread by name. Routing is automatic; use launch_receiver first if no thread exists.",
        args: {
          thread: tool.schema.string().describe("Visible thread name returned by launch_receiver or list_threads."),
          message: tool.schema.string().describe("Message to inject into the teammate session."),
          variant: tool.schema.string().optional().describe("Variant for this delivered message only. Sending does not change the teammate model."),
        },
        async execute(args) {
          if (!identity) throw new Error("AgentSymphony hub is waiting for the current OpenCode session identity.")
          const currentIdentity = identity
          const conversation = await findVisibleConversationByThread(hub, currentIdentity.id, args.thread)
          if (!conversation) throw new Error(`Unknown AgentSymphony thread: ${args.thread}`)
          const result = await sendHubMessageOrOfflineNotice({
            hub,
            directory,
            conversationId: conversation.id,
            fromInstanceId: currentIdentity.id,
            content: args.message,
            variant: args.variant,
          })
          return result.ok
            ? respondHub({ hub, directory, identity: currentIdentity, type: "hub.thread.sent", summary: `Queued message ${result.message.id} to thread ${args.thread}.`, data: { message: result.message, thread: describeConversation(conversation) } })
            : respondHub({ ok: false, hub, directory, identity: currentIdentity, type: "hub.thread.target_offline", summary: result.summary, data: { offline: result.data, thread: describeConversation(conversation) } })
        },
      }),
      agentsymphony_hub_reply: tool({
        description: "Conversation reply: reply to an inbound AgentSymphony message. Omit thread for the latest inbound message; provide thread only when handling multiple active threads.",
        args: {
          thread: tool.schema.string().optional().describe("Visible thread name. Omit unless handling multiple active threads."),
          message: tool.schema.string().describe("Reply text to inject into the originating sender session."),
          variant: tool.schema.string().optional().describe("Variant for this reply only. Replying does not change the teammate model."),
        },
        async execute(args) {
          if (!identity) throw new Error("AgentSymphony hub is waiting for the current OpenCode session identity.")
          const currentIdentity = identity
          const context = args.thread ? await replyContext.getByThread(args.thread) : await replyContext.getLatest()
          if (!context) throw new Error("No inbound AgentSymphony conversation is available to reply to.")
          try {
            await hub.getConversation(context.conversationId)
          } catch {
            return respondHub({ ok: false, hub, directory, identity: currentIdentity, type: "hub.reply.stale_context", summary: "The conversation for this reply context no longer exists (may have been archived or the teammate deleted).", data: { context } })
          }
          const result = await sendHubMessageOrOfflineNotice({
            hub,
            directory,
            conversationId: context.conversationId,
            fromInstanceId: currentIdentity.id,
            content: args.message,
            variant: args.variant,
          })
          return result.ok
            ? respondHub({ hub, directory, identity: currentIdentity, type: "hub.reply.sent", summary: `Queued reply ${result.message.id}.`, data: { message: result.message, context } })
            : respondHub({ ok: false, hub, directory, identity: currentIdentity, type: "hub.reply.target_offline", summary: result.summary, data: { offline: result.data, context } })
        },
      }),
      agentsymphony_hub_list_threads: tool({
        description: "Inspection only: list visible threads. Do not poll this tool for new messages; hub messages are injected automatically.",
        args: {},
        async execute() {
          if (!identity) throw new Error("AgentSymphony hub is waiting for the current OpenCode session identity.")
          const currentIdentity = identity
          const conversations = await hub.listConversationsForInstance(currentIdentity.id)
          const contexts: ReplyContext[] = await replyContext.list()
          const threads = conversations.map((conversation) => ({
            threadName: conversation.threadName,
            title: conversation.title,
            conversationId: conversation.id,
            createdByThisInstance: conversation.createdByInstanceId === currentIdentity.id,
            parentInstanceId: conversation.parentInstanceId,
            targetInstanceId: conversation.targetInstanceId,
            updatedAt: conversation.updatedAt,
            hasReplyContext: contexts.some((context) => context.conversationId === conversation.id),
          }))
          return respondHub({ hub, directory, identity: currentIdentity, type: "hub.threads", summary: `Listed ${threads.length} AgentSymphony threads.`, data: { threads } })
        },
      }),
      agentsymphony_hub_read_thread: tool({
        description: "Inspection only: read recent history for a visible thread. Do not poll this tool to receive messages; hub messages are injected automatically.",
        args: {
          thread: tool.schema.string().describe("Visible AgentSymphony thread name."),
          limit: tool.schema.number().optional().describe("Maximum number of recent messages to return. Defaults to 20."),
          includeContent: tool.schema.boolean().optional().describe("Whether to include message content. Defaults to true."),
        },
        async execute(args) {
          if (!identity) throw new Error("AgentSymphony hub is waiting for the current OpenCode session identity.")
          const currentIdentity = identity
          const conversations = await hub.listConversationsForInstance(currentIdentity.id)
          const conversation = conversations.find((candidate) => candidate.threadName === args.thread)
          if (!conversation) throw new Error(`Unknown AgentSymphony thread: ${args.thread}`)
          const messages = await hub.listMessagesForConversation(conversation.id, args.limit)
          const includeContent = args.includeContent ?? true
          return respondHub({ hub, directory, identity: currentIdentity, type: "hub.thread.messages", summary: `Read ${messages.length} messages from thread ${args.thread}.`, data: {
            thread: {
              threadName: conversation.threadName,
              title: conversation.title,
              conversationId: conversation.id,
              createdByThisInstance: conversation.createdByInstanceId === currentIdentity.id,
              updatedAt: conversation.updatedAt,
            },
            messages: messages.map((message) => ({
              id: message.id,
              fromThisInstance: message.fromInstanceId === currentIdentity.id,
              toThisInstance: message.toInstanceId === currentIdentity.id,
              createdAt: message.createdAt,
              status: message.status,
              content: includeContent ? message.content : undefined,
            })),
          } })
        },
      }),
      agentsymphony_hub_delete_teammate: tool({
        description: "Team cleanup: delete a stale offline teammate owned by this session. Automatically terminates associated processes before removing the hub record. Related threads and hub messages are removed automatically. Ask the user before calling this tool.",
        args: {
          targetInstanceId: tool.schema.string().describe("Offline teammate instance id shown in system_status or warnings. Must be connected to this session."),
        },
        async execute(args) {
          if (!identity) throw new Error("AgentSymphony hub is waiting for the current OpenCode session identity.")
          const sessionId = await findSessionIdForInstance(directory, args.targetInstanceId)
          if (sessionId) {
            let pids: number[] = []
            const recordedPid = await loadReceiverPid(directory, sessionId)
            if (recordedPid !== undefined) {
              pids.push(recordedPid)
              const children = await findChildPids(recordedPid)
              pids.push(...children)
            }
            const scannedPids = await findOpenCodePidsForSession(sessionId)
            for (const pid of scannedPids) {
              if (!pids.includes(pid)) pids.push(pid)
            }
            if (pids.length > 0) {
              await killProcessesGracefully(pids)
              await new Promise((resolve) => setTimeout(resolve, 4000))
            }
          }
          const result = await deleteVisibleTeammate(hub, identity.id, args.targetInstanceId)
          return respondHub({ hub, directory, identity, type: "hub.teammate.deleted", summary: result.instance ? `Deleted teammate ${args.targetInstanceId} and related threads.` : `Teammate ${args.targetInstanceId} was not found.`, data: result })
        },
      }),
    },
    async "chat.message"(input) {
      await bindSessionIdentity(input.sessionID)
    },
    async "chat.params"(input) {
      await bindSessionIdentity(input.sessionID)
    },
    async "experimental.chat.system.transform"(_input, output) {
      teamSystemGuidance ??= buildTeamSystemGuidance(await loadModelCatalog(directory))
      if (!output.system.includes(teamSystemGuidance)) output.system.push(teamSystemGuidance)
    },
    async "command.execute.before"(input) {
      await bindSessionIdentity(input.sessionID)
    },
    async "tool.execute.before"(input) {
      await bindSessionIdentity(input.sessionID)
    },
    async "tool.execute.after"(input) {
      await bindSessionIdentity(input.sessionID)
    },
  }
}

export default AgentSymphonyPlugin
