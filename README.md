# AgentSymphony

AgentSymphony is an OpenCode-only collaboration plugin that lets one OpenCode agent create and talk to other OpenCode conversations as if they were independent user-facing sessions.

## Target Architecture

- A top-level agent receives the real user's task.
- A background AgentSymphony hub stays alive and routes messages between OpenCode instances.
- Every OpenCode instance loads the AgentSymphony plugin at startup and registers with the hub.
- Parent agents create conversations by binding a parent instance to a target child instance.
- Messages are delivered through the hub to the target instance plugin.
- The target plugin injects incoming text into its own TUI via OpenCode's TUI API (`appendPrompt` + `submitPrompt`).
- The child agent experiences the message as input arriving in its own interactive OpenCode instance, not as a hidden `opencode run` call.
- Conversations carry a creator marker (`createdByInstanceId`) and a visible `threadName`. Injected prompts hide routing IDs but show the thread name and whether this instance created the thread. The target agent can reply with `agentsymphony_hub_reply`; if multiple threads are active, it can pass the visible thread name and the plugin resolves the route.

## Current Implementation Status

- Implemented: hub protocol, in-memory hub, instance registration, conversation routing, inbox polling, message acknowledgement, and TUI injection adapter interfaces.
- Implemented: legacy local conversation/session tools using `opencode run --session`.
- Next: replace legacy send path with hub routing and add a long-running hub process plus plugin poller.

## Tools

- `agentsymphony_create_conversation`: creates a tracked child OpenCode conversation, optionally with an initial message.
- `agentsymphony_send_message`: sends a message to a child conversation and records the assistant response.
- `agentsymphony_get_conversation`: reads one conversation with messages, counts, and latest state.
- `agentsymphony_read_messages`: reads recorded messages for a conversation.
- `agentsymphony_open_conversation`: opens a child conversation in a new terminal running the OpenCode TUI.
- `agentsymphony_list_conversations`: lists known child conversations.

Tool results use a consistent JSON envelope with `ok`, `type`, `summary`, and `data` fields so parent agents can quickly decide what happened before inspecting details.

## Terminal Windows

Set `openTui: true` when creating a conversation or sending a message to open a new terminal after the child session exists. You can also call `agentsymphony_open_conversation` later.

AgentSymphony keeps one TUI window per conversation. Reopening the same conversation reuses the existing live window record instead of creating another terminal. If the recorded terminal process is gone, the next open creates a replacement window. Window records are persisted under `.agentsymphony/windows.json`, so this reuse survives an OpenCode/plugin restart.

By default AgentSymphony tries common Linux terminal launchers such as `xdg-terminal-exec`, `ghostty`, `kitty`, `wezterm`, `alacritty`, `gnome-terminal`, `konsole`, and `xfce4-terminal`.

Use `AGENTSYMPHONY_TERMINAL` to override the launch command. Supported placeholders are `{sessionId}`, `{title}`, `{directory}`, and `{command}`. Example:

```sh
AGENTSYMPHONY_TERMINAL="ghostty --title {title} -e {command}"
```

## Local State

Conversation metadata and message history are stored under `.agentsymphony/` in the active project directory. This directory is intentionally ignored by git.

## Development

```sh
npm install
npm run hub
npm run verify
```

Run `npm run hub` in one terminal before starting OpenCode instances that should participate in AgentSymphony hub routing. The default hub URL is `http://127.0.0.1:4777`; override it with `AGENTSYMPHONY_HUB_URL`.

Open `http://127.0.0.1:4777/` to view the hub monitoring dashboard. It shows live instances, threads, message counts, delivery status, and recent messages.

The hub filters stale instances using `AGENTSYMPHONY_INSTANCE_TTL_MS`, defaulting to `15000`. A stale instance is not listed and cannot be used as a routing target.

Hub state is persisted by default to `.agentsymphony/hub-store.json`, including instances, conversations, and message delivery state. Override the path with `AGENTSYMPHONY_HUB_STORE`.

Message history is not injected automatically. Agents can query it on demand with `agentsymphony_hub_list_threads` and `agentsymphony_hub_read_thread`.

After changing `opencode.json` or plugin files, restart OpenCode so the plugin is reloaded.
