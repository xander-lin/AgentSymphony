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

export const AgentSymphonyPlugin: Plugin = async ({ directory, client }) => {
  const bus = new FileMessageBus(directory)
  const runner = new CliOpenCodeRunner()
  const terminal = new LocalTerminalLauncher(directory)
  const service = new AgentSymphonyService(bus, runner, terminal)
  const identityStore = new FileInstanceIdentityStore()
  let identity: InstanceIdentity | undefined
  const bootstrapSessionId = process.env.AGENTSYMPHONY_RESUME_SESSION_ID
  delete process.env.AGENTSYMPHONY_RESUME_SESSION_ID
  const bindSessionIdentity = async (sessionId: string): Promise<InstanceIdentity> => {
    identity = await identityStore.load(directory, sessionId, identity)
    return identity
  }
  if (bootstrapSessionId) await bindSessionIdentity(bootstrapSessionId)
  const hub = new HttpAgentSymphonyHubClient()
  const replyContext = new MemoryReplyContextStore()
  const hubConnector = startHubConnector({ hub, identity: () => identity, tui: new OpenCodeTuiController(client), replyContext })

  return {
    tool: {
      agentsymphony_hub_status: tool({
        description: "Get this OpenCode instance's AgentSymphony hub registration status.",
        args: {},
        async execute() {
          const hubState = hubConnector.getStatus()
          return respond("hub.status", hubState.connected ? `Connected to AgentSymphony hub as ${hubState.instance.id}.` : "AgentSymphony hub is not connected.", {
            connected: hubState.connected,
            instance: hubState.connected ? hubState.instance : undefined,
            identity,
            error: hubState.connected ? undefined : hubState.error,
          })
        },
      }),
      agentsymphony_hub_list_instances: tool({
        description: "List OpenCode instances currently registered with the AgentSymphony hub.",
        args: {},
        async execute() {
          const instances = await hub.listInstances()
          return respond("hub.instances", `Listed ${instances.length} AgentSymphony hub instances.`, { instances })
        },
      }),
      agentsymphony_hub_launch_receiver: tool({
        description: "Launch a new OpenCode receiver TUI with a bootstrap prompt and wait for hub registration.",
        args: {
          title: tool.schema.string().optional().describe("Optional display title for the launched receiver."),
          prompt: tool.schema.string().optional().describe("Bootstrap prompt to submit when the receiver TUI starts."),
          timeoutMs: tool.schema.number().optional().describe("Maximum time to wait for receiver registration."),
        },
        async execute(args) {
          const result = await launchHubReceiver({
            hub,
            directory,
            title: args.title,
            prompt: args.prompt,
            timeoutMs: args.timeoutMs,
          })
          return respond("hub.receiver.launched", `Launched receiver ${result.instance.id}.`, result)
        },
      }),
      agentsymphony_hub_resume_receiver: tool({
        description: "Resume an existing OpenCode receiver session and wait for hub registration.",
        args: {
          sessionId: tool.schema.string().describe("OpenCode session id to resume."),
          processId: tool.schema.number().optional().describe("Optional existing OpenCode process id. If it is still running this session, the process is reused."),
          title: tool.schema.string().optional().describe("Optional display title for the resumed receiver."),
          prompt: tool.schema.string().optional().describe("Bootstrap prompt to submit when the receiver TUI resumes."),
          timeoutMs: tool.schema.number().optional().describe("Maximum time to wait for receiver registration."),
        },
        async execute(args) {
          const result = await resumeHubReceiver({
            hub,
            directory,
            sessionId: args.sessionId,
            processId: args.processId,
            title: args.title,
            prompt: args.prompt,
            timeoutMs: args.timeoutMs,
          })
          return respond("hub.receiver.resumed", `Resumed receiver ${result.instance.id}.`, result)
        },
      }),
      agentsymphony_hub_create_conversation: tool({
        description: "Create a hub-routed AgentSymphony conversation targeting another OpenCode instance.",
        args: {
          targetInstanceId: tool.schema.string().describe("Registered AgentSymphony target instance id."),
          title: tool.schema.string().describe("Human-readable conversation title."),
          threadName: tool.schema.string().optional().describe("Short name the agent can use to identify and reply in this conversation."),
        },
        async execute(args) {
          if (!identity) throw new Error("AgentSymphony hub is waiting for the current OpenCode session identity.")
          const currentIdentity = identity
          const conversation = await hub.createConversation({
            parentInstanceId: currentIdentity.id,
            targetInstanceId: args.targetInstanceId,
            title: args.title,
            threadName: args.threadName,
          })
          return respond("hub.conversation.created", `Created hub conversation ${conversation.id}.`, conversation)
        },
      }),
      agentsymphony_hub_send_message: tool({
        description: "Send a message through the AgentSymphony hub to the other OpenCode instance in a conversation.",
        args: {
          conversationId: tool.schema.string().describe("AgentSymphony hub conversation id."),
          message: tool.schema.string().describe("Message to inject into the target instance's TUI."),
        },
        async execute(args) {
          if (!identity) throw new Error("AgentSymphony hub is waiting for the current OpenCode session identity.")
          const currentIdentity = identity
          const result = await sendHubMessageOrOfflineNotice({
            hub,
            directory,
            conversationId: args.conversationId,
            fromInstanceId: currentIdentity.id,
            content: args.message,
          })
          return result.ok
            ? respond("hub.message.sent", `Queued hub message ${result.message.id}.`, result.message)
            : respondFailure("hub.message.target_offline", result.summary, result.data)
        },
      }),
      agentsymphony_hub_reply: tool({
        description: "Reply to the latest inbound AgentSymphony hub message. Routing is handled automatically.",
        args: {
          thread: tool.schema.string().optional().describe("Optional visible AgentSymphony thread name. If omitted, replies to the latest inbound thread."),
          message: tool.schema.string().describe("Reply message to send back to the originating AgentSymphony conversation."),
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
          })
          return result.ok
            ? respond("hub.reply.sent", `Queued reply ${result.message.id}.`, { message: result.message, context })
            : respondFailure("hub.reply.target_offline", result.summary, { offline: result.data, context })
        },
      }),
      agentsymphony_hub_list_threads: tool({
        description: "List visible AgentSymphony reply threads known to this OpenCode instance.",
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
          return respond("hub.threads", `Listed ${threads.length} AgentSymphony threads.`, { threads })
        },
      }),
      agentsymphony_hub_read_thread: tool({
        description: "Read recent AgentSymphony hub message history for a visible thread.",
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
          return respond("hub.thread.messages", `Read ${messages.length} messages from thread ${args.thread}.`, {
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
          })
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

async function sendHubMessageOrOfflineNotice(input: {
  hub: HttpAgentSymphonyHubClient
  directory: string
  conversationId: string
  fromInstanceId: string
  content: string
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
      },
    }
  }
  return { ok: true, message: await input.hub.sendMessage({ conversationId: input.conversationId, fromInstanceId: input.fromInstanceId, content: input.content }) }
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
