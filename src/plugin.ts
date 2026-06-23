import { type Plugin, tool } from "@opencode-ai/plugin"
import { startHubConnector } from "./hub/connector.ts"
import { HttpAgentSymphonyHubClient } from "./hub/http-client.ts"
import { MemoryReplyContextStore } from "./hub/reply-context.ts"
import { FileInstanceIdentityStore } from "./instance/identity.ts"
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
  const identity = await new FileInstanceIdentityStore().load(directory)
  const hub = new HttpAgentSymphonyHubClient()
  const replyContext = new MemoryReplyContextStore()
  const hubConnector = startHubConnector({ hub, identity, tui: new OpenCodeTuiController(client), replyContext })

  return {
    tool: {
      agentsymphony_hub_status: tool({
        description: "Get this OpenCode instance's AgentSymphony hub registration status.",
        args: {},
        async execute() {
          const hubState = hubConnector.getStatus()
          return respond("hub.status", hubState.connected ? `Connected to AgentSymphony hub as ${identity.id}.` : "AgentSymphony hub is not connected.", {
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
      agentsymphony_hub_create_conversation: tool({
        description: "Create a hub-routed AgentSymphony conversation targeting another OpenCode instance.",
        args: {
          targetInstanceId: tool.schema.string().describe("Registered AgentSymphony target instance id."),
          title: tool.schema.string().describe("Human-readable conversation title."),
          threadName: tool.schema.string().optional().describe("Short name the agent can use to identify and reply in this conversation."),
        },
        async execute(args) {
          const conversation = await hub.createConversation({
            parentInstanceId: identity.id,
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
          const message = await hub.sendMessage({
            conversationId: args.conversationId,
            fromInstanceId: identity.id,
            content: args.message,
          })
          return respond("hub.message.sent", `Queued hub message ${message.id}.`, message)
        },
      }),
      agentsymphony_hub_reply: tool({
        description: "Reply to the latest inbound AgentSymphony hub message. Routing is handled automatically.",
        args: {
          thread: tool.schema.string().optional().describe("Optional visible AgentSymphony thread name. If omitted, replies to the latest inbound thread."),
          message: tool.schema.string().describe("Reply message to send back to the originating AgentSymphony conversation."),
        },
        async execute(args) {
          const context = args.thread ? await replyContext.getByThread(args.thread) : await replyContext.getLatest()
          if (!context) throw new Error("No inbound AgentSymphony conversation is available to reply to.")
          const message = await hub.sendMessage({
            conversationId: context.conversationId,
            fromInstanceId: identity.id,
            content: args.message,
          })
          return respond("hub.reply.sent", `Queued reply ${message.id}.`, { message, context })
        },
      }),
      agentsymphony_hub_list_threads: tool({
        description: "List visible AgentSymphony reply threads known to this OpenCode instance.",
        args: {},
        async execute() {
          const conversations = await hub.listConversationsForInstance(identity.id)
          const contexts = await replyContext.list()
          const threads = conversations.map((conversation) => ({
            threadName: conversation.threadName,
            title: conversation.title,
            conversationId: conversation.id,
            createdByThisInstance: conversation.createdByInstanceId === identity.id,
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
          const conversations = await hub.listConversationsForInstance(identity.id)
          const conversation = conversations.find((candidate) => candidate.threadName === args.thread)
          if (!conversation) throw new Error(`Unknown AgentSymphony thread: ${args.thread}`)
          const messages = await hub.listMessagesForConversation(conversation.id, args.limit)
          const includeContent = args.includeContent ?? true
          return respond("hub.thread.messages", `Read ${messages.length} messages from thread ${args.thread}.`, {
            thread: {
              threadName: conversation.threadName,
              title: conversation.title,
              conversationId: conversation.id,
              createdByThisInstance: conversation.createdByInstanceId === identity.id,
              updatedAt: conversation.updatedAt,
            },
            messages: messages.map((message) => ({
              id: message.id,
              fromThisInstance: message.fromInstanceId === identity.id,
              toThisInstance: message.toInstanceId === identity.id,
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
  }
}

function respond(type: string, summary: string, data: unknown): string {
  return JSON.stringify({ ok: true, type, summary, data }, null, 2)
}

export default AgentSymphonyPlugin
