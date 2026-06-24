import { type Plugin, tool } from "@opencode-ai/plugin"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { startHubConnector } from "./hub/connector.ts"
import { HttpAgentSymphonyHubClient } from "./hub/http-client.ts"
import { launchHubReceiver, resumeHubReceiver } from "./hub/receiver-launcher.ts"
import { MemoryReplyContextStore } from "./hub/reply-context.ts"
import type { HubConversation, HubMessage } from "./hub/types.ts"
import { FileInstanceIdentityStore, type InstanceIdentity } from "./instance/identity.ts"
import { FileMessageBus } from "./messages/file.ts"
import { CliOpenCodeRunner } from "./runtime/cli.ts"
import { AgentSymphonyService } from "./symphony/service.ts"
import { LocalTerminalLauncher } from "./terminal/local.ts"
import { OpenCodeTuiController } from "./tui/opencode.ts"

const TEAM_SYSTEM_GUIDANCE = `Team workflow guidance:
- Treat AgentSymphony as your teammate system: launch teammates for parallel, isolated work when delegation reduces risk or latency.
- Use a teammate for independent research, focused implementation, review, verification, or competing approaches. Keep work local if the task is tiny, tightly sequential, or requires one continuous edit.
- Start a teammate with agentsymphony_hub_launch_receiver. You do not need a conversation description; use threadName only when a stable short name helps later coordination.
- Send follow-up work with agentsymphony_hub_send_thread. Reply to inbound teammate messages with agentsymphony_hub_reply. Do not poll list/read tools for delivery; teammate messages are injected automatically.
- Use agentsymphony_hub_system_status when deciding whether to resume or clean up offline teammates. Resume useful offline teammates with agentsymphony_hub_resume_receiver.
- Model selection: use cheaper/faster models for straightforward lookup, summarization, formatting, and narrow checks; use stronger models for architecture, ambiguous debugging, multi-file edits, or high-stakes review. Launch may set model for a new teammate. Later sends/replies may set variant for that prompt only and do not change the teammate model.
- Keep delegation prompts scoped and outcome-oriented: give the teammate the goal, constraints, files or areas to inspect, expected output, and whether to edit or only report.
- Summarize teammate results before acting on them; do not blindly merge conflicting conclusions.`

export const AgentSymphonyPlugin: Plugin = async ({ directory, client }) => {
  const bus = new FileMessageBus(directory)
  const runner = new CliOpenCodeRunner()
  const terminal = new LocalTerminalLauncher(directory)
  const service = new AgentSymphonyService(bus, runner, terminal)
  const identityStore = new FileInstanceIdentityStore()
  let identity: InstanceIdentity | undefined
  let currentSessionId: string | undefined
  const bootstrapSessionId = process.env.AGENTSYMPHONY_RESUME_SESSION_ID
  delete process.env.AGENTSYMPHONY_RESUME_SESSION_ID
  const bindSessionIdentity = async (sessionId: string): Promise<InstanceIdentity> => {
    currentSessionId = sessionId
    identity = await identityStore.load(directory, sessionId, identity)
    return identity
  }
  if (bootstrapSessionId) await bindSessionIdentity(bootstrapSessionId)
  const hub = new HttpAgentSymphonyHubClient()
  const replyContext = new MemoryReplyContextStore()
  const hubConnector = startHubConnector({ hub, identity: () => identity, tui: new OpenCodeTuiController(client, () => currentSessionId, directory), replyContext })

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
              cleanupThread: "agentsymphony_hub_archive_thread",
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
          prompt: tool.schema.string().optional().describe("Optional startup prompt for the teammate. Do not use it to poll threads; hub messages are injected automatically."),
          model: tool.schema.string().optional().describe("Initial provider/model id, for example opencode-go/deepseek-v4-pro. Only launch may set model."),
          threadName: tool.schema.string().optional().describe("Stable short name for later send_thread calls. If omitted, AgentSymphony generates one."),
          timeoutMs: tool.schema.number().optional().describe("Maximum milliseconds to wait for receiver registration."),
        },
        async execute(args) {
          if (!identity) throw new Error("AgentSymphony hub is waiting for the current OpenCode session identity.")
          const currentIdentity = identity
          const result = await launchHubReceiver({
            hub,
            directory,
            title: args.title,
            prompt: args.prompt,
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
          return respondHub({ hub, directory, identity: currentIdentity, type: "hub.receiver.launched", summary: `Launched receiver ${result.instance.id} and connected thread ${conversation.threadName}.`, data: {
            ...result,
            thread: describeConversation(conversation),
          } })
        },
      }),
      agentsymphony_hub_resume_receiver: tool({
        description: "Team recovery: resume an offline teammate by OpenCode session id. Use when a warning says an offline teammate is still needed.",
        args: {
          sessionId: tool.schema.string().describe("OpenCode session id to resume."),
          processId: tool.schema.number().optional().describe("Existing process id to reuse only if it is still running this same session."),
          title: tool.schema.string().optional().describe("Window title only."),
          prompt: tool.schema.string().optional().describe("Optional resume prompt for the teammate. Do not use it to poll threads; hub messages are injected automatically."),
          variant: tool.schema.string().optional().describe("Variant for the resume prompt only. Resume does not change the session model."),
          timeoutMs: tool.schema.number().optional().describe("Maximum milliseconds to wait for receiver registration."),
        },
        async execute(args) {
          const result = await resumeHubReceiver({
            hub,
            directory,
            sessionId: args.sessionId,
            processId: args.processId,
            title: args.title,
            prompt: args.prompt,
            variant: args.variant,
            timeoutMs: args.timeoutMs,
          })
          return respondHub({ hub, directory, identity, type: "hub.receiver.resumed", summary: `Resumed receiver ${result.instance.id}.`, data: result })
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
          const contexts = await replyContext.list()
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
      agentsymphony_hub_archive_thread: tool({
        description: "Team cleanup: archive a visible stale thread online. Removes the thread and its hub messages; also removes offline teammate records no longer used by any thread.",
        args: {
          thread: tool.schema.string().describe("Visible stale thread name to archive. Ask the user before calling this tool."),
        },
        async execute(args) {
          if (!identity) throw new Error("AgentSymphony hub is waiting for the current OpenCode session identity.")
          const conversation = await findVisibleConversationByThread(hub, identity.id, args.thread)
          if (!conversation) throw new Error(`Cannot archive thread outside this teammate set: ${args.thread}`)
          const result = await hub.archiveThread(args.thread)
          return respondHub({ hub, directory, identity, type: "hub.thread.archived", summary: result.conversation ? `Archived thread ${args.thread}.` : `Thread ${args.thread} was not found.`, data: result })
        },
      }),
      agentsymphony_create_conversation: tool({
        description: "Create a child OpenCode conversation for delegating work to another agent.",
        args: {
          title: tool.schema.string().describe("Human-readable title for the child conversation."),
          initialMessage: tool.schema.string().optional().describe("Optional first user message to send immediately."),
          agent: tool.schema.string().optional().describe("Optional OpenCode agent name to use for the child session."),
          model: tool.schema.string().optional().describe("Optional provider/model id for the child session."),
          directory: tool.schema.string().optional().describe("Optional working directory for the child session."),
          openTui: tool.schema.boolean().optional().describe("Open a new terminal running `opencode --session` after the first message."),
        },
        async execute(args) {
          const conversation = await service.createConversation(args)
          return respond("conversation.created", `Created AgentSymphony conversation ${conversation.id}.`, conversation)
        },
      }),
      agentsymphony_send_message: tool({
        description: "Send a user-style message to a tracked AgentSymphony child conversation.",
        args: {
          conversationId: tool.schema.string().describe("AgentSymphony conversation id."),
          message: tool.schema.string().describe("Message to deliver as the child session's user prompt."),
          openTui: tool.schema.boolean().optional().describe("Open a new terminal running `opencode --session` after the response."),
        },
        async execute(args) {
          const result = await service.sendMessage(args)
          return respond("message.sent", `Sent message to ${result.conversation.id}.`, result)
        },
      }),
      agentsymphony_get_conversation: tool({
        description: "Get one AgentSymphony conversation with its recorded messages and latest state.",
        args: {
          conversationId: tool.schema.string().describe("AgentSymphony conversation id."),
        },
        async execute(args) {
          const detail = await service.getConversation(args.conversationId)
          return respond("conversation.detail", `Loaded ${detail.messageCount} messages for ${args.conversationId}.`, detail)
        },
      }),
      agentsymphony_read_messages: tool({
        description: "Read recorded parent and child messages from an AgentSymphony conversation.",
        args: {
          conversationId: tool.schema.string().describe("AgentSymphony conversation id."),
          since: tool.schema.string().optional().describe("Optional ISO timestamp; only newer messages are returned."),
        },
        async execute(args) {
          const messages = await service.readMessages(args.conversationId, args.since)
          return respond("messages.read", `Read ${messages.length} messages from ${args.conversationId}.`, { messages })
        },
      }),
      agentsymphony_open_conversation: tool({
        description: "Open a tracked child conversation in a new terminal running the OpenCode TUI.",
        args: {
          conversationId: tool.schema.string().describe("AgentSymphony conversation id."),
        },
        async execute(args) {
          const result = await service.openConversation(args.conversationId)
          const action = result.window.reused ? "Reused" : "Opened"
          return respond("conversation.opened", `${action} TUI for ${result.conversation.id}.`, result)
        },
      }),
      agentsymphony_list_conversations: tool({
        description: "List child OpenCode conversations tracked by AgentSymphony.",
        args: {},
        async execute() {
          const conversations = await service.listConversations()
          return respond("conversations.list", `Listed ${conversations.length} AgentSymphony conversations.`, { conversations })
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
      if (!output.system.includes(TEAM_SYSTEM_GUIDANCE)) output.system.push(TEAM_SYSTEM_GUIDANCE)
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

function respond(type: string, summary: string, data: unknown): string {
  return JSON.stringify({ ok: true, type, summary, data }, null, 2)
}

function respondFailure(type: string, summary: string, data: unknown): string {
  return JSON.stringify({ ok: false, type, summary, data }, null, 2)
}

async function respondHub(input: {
  ok?: boolean
  hub: HttpAgentSymphonyHubClient
  directory: string
  identity: InstanceIdentity | undefined
  type: string
  summary: string
  data: unknown
}): Promise<string> {
  const warnings = await offlineReceiverWarnings(input.hub, input.directory, input.identity)
  return JSON.stringify({
    ok: input.ok ?? true,
    type: input.type,
    summary: input.summary,
    data: input.data,
    ...(warnings.length > 0 ? { warnings } : {}),
  }, null, 2)
}

export async function offlineReceiverWarnings(hub: Pick<HttpAgentSymphonyHubClient, "getMonitorSnapshot">, directory: string, identity: InstanceIdentity | undefined): Promise<unknown[]> {
  if (!identity) return []
  const snapshot = await hub.getMonitorSnapshot()
  const liveInstanceIds = new Set(snapshot.instances.filter((instance) => instance.online !== false).map((instance) => instance.id))
  const instancesById = new Map(snapshot.instances.map((instance) => [instance.id, instance]))
  const offlineThreads = snapshot.conversations
    .filter((conversation) => conversation.parentInstanceId === identity.id || conversation.targetInstanceId === identity.id)
    .map((conversation) => {
      const targetInstanceId = conversation.parentInstanceId === identity.id ? conversation.targetInstanceId : conversation.parentInstanceId
      return { conversation, targetInstanceId, target: instancesById.get(targetInstanceId) }
    })
    .filter((item) => item.target && !liveInstanceIds.has(item.targetInstanceId))

  if (offlineThreads.length === 0) return []
  return [{
    type: "hub.offline_receivers",
    summary: "Some receiver instances connected to this node are offline. Decide whether each receiver is stale and should be cleaned up, or still needed and should be resumed.",
    decisionRequired: true,
    question: "Are these offline receivers outdated and safe to delete/archive, or should they be resumed?",
    offlineReceivers: await Promise.all(offlineThreads.map(async ({ conversation, targetInstanceId, target }) => ({
      threadName: conversation.threadName,
      title: conversation.title,
      conversationId: conversation.id,
      targetInstanceId,
      targetName: target?.name,
      lastSeenAt: target?.lastSeenAt,
      choices: {
        resume: { tool: "agentsymphony_hub_resume_receiver", sessionId: await findSessionIdForInstance(directory, targetInstanceId) },
        cleanup: { tool: "agentsymphony_hub_archive_thread", thread: conversation.threadName, note: "Ask the user before archiving stale teammate history." },
      },
    }))),
  }]
}

async function sendHubMessageOrOfflineNotice(input: {
  hub: HttpAgentSymphonyHubClient
  directory: string
  conversationId: string
  fromInstanceId: string
  content: string
  variant?: string
}): Promise<{ ok: true; message: HubMessage } | { ok: false; summary: string; data: unknown }> {
  const conversation = await input.hub.getConversation(input.conversationId)
  if (!conversation) throw new Error(`Unknown hub conversation: ${input.conversationId}`)
  const targetInstanceId = input.fromInstanceId === conversation.parentInstanceId ? conversation.targetInstanceId : conversation.parentInstanceId
  const liveInstances = await input.hub.listInstances()
  if (!liveInstances.some((instance) => instance.id === targetInstanceId)) {
    const sessionId = await findSessionIdForInstance(input.directory, targetInstanceId)
    return {
      ok: false,
      summary: `Target instance ${targetInstanceId} is offline. Resume it before sending this message.`,
      data: {
        conversation: describeConversation(conversation),
        targetInstanceId,
        resume: sessionId ? { tool: "agentsymphony_hub_resume_receiver", sessionId } : { tool: "agentsymphony_hub_resume_receiver", sessionId: undefined },
        unsentMessage: input.content,
        unsentVariant: input.variant,
      },
    }
  }
  return { ok: true, message: await input.hub.sendMessage({ conversationId: input.conversationId, fromInstanceId: input.fromInstanceId, content: input.content, variant: input.variant }) }
}

async function findVisibleConversationByThread(hub: HttpAgentSymphonyHubClient, instanceId: string, threadName: string): Promise<HubConversation | undefined> {
  const conversations = await hub.listConversationsForInstance(instanceId)
  return conversations.find((candidate) => candidate.threadName === threadName)
}

function describeConversation(conversation: HubConversation): Pick<HubConversation, "id" | "threadName" | "title" | "parentInstanceId" | "targetInstanceId"> {
  return {
    id: conversation.id,
    threadName: conversation.threadName,
    title: conversation.title,
    parentInstanceId: conversation.parentInstanceId,
    targetInstanceId: conversation.targetInstanceId,
  }
}

function defaultThreadName(value: string): string {
  return `receiver-${value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(-12)}`
}

async function findSessionIdForInstance(directory: string, instanceId: string): Promise<string | undefined> {
  const instancesDirectory = join(directory, ".agentsymphony", "instances")
  try {
    const entries = await readdir(instancesDirectory)
    for (const entry of entries) {
      if (!entry.startsWith("session-") || !entry.endsWith(".json")) continue
      const parsed = JSON.parse(await readFile(join(instancesDirectory, entry), "utf8")) as Partial<InstanceIdentity>
      if (parsed.id === instanceId) return entry.slice("session-".length, -".json".length)
    }
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined
    if (code !== "ENOENT") throw error
  }
  return undefined
}

export default AgentSymphonyPlugin
