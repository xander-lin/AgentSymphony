# AgentSymphony

AgentSymphony is an OpenCode-only team plugin. It lets one OpenCode session launch and coordinate teammate sessions as independent interactive agents.

Use the product as a team workflow, not as a low-level routing system: launch teammates for parallel work, send scoped tasks by thread name, and let replies arrive through normal injected messages.

## Target Architecture

- A top-level agent receives the real user's task and decides whether a teammate would reduce risk or latency.
- A background AgentSymphony hub stays alive and routes messages between OpenCode instances.
- Every OpenCode instance loads the AgentSymphony plugin at startup and registers with the hub.
- Parent agents start teammates; launching a teammate automatically creates the communication thread.
- A pair of OpenCode instances can have at most one hub conversation at a time; duplicate create requests return the existing conversation.
- Messages are delivered through the hub to the target instance plugin.
- The target plugin injects incoming text into its own OpenCode session with `session.promptAsync`, so messages show in the TUI and are queued reliably even while the model is busy.
- The teammate experiences the message as input arriving in its own interactive OpenCode instance, not as a hidden `opencode run` call.
- Conversations carry a creator marker (`createdByInstanceId`) and a visible `threadName`. Injected prompts hide routing IDs but show the thread name and whether this instance created the thread. The target agent can reply with `agentsymphony_hub_reply`; if multiple threads are active, it can pass the visible thread name and the plugin resolves the route.

## Current Implementation Status

- Implemented: hub protocol, persistent hub, instance registration, conversation routing, inbox polling, message acknowledgement, TUI injection, receiver launch/resume tools, and monitoring dashboard.
- Implemented: legacy local conversation/session tools using `opencode run --session`.
- Next: harden recovered-session runtime behavior across OpenCode versions and terminal launchers.

## Tools

- `agentsymphony_hub_launch_receiver`: starts a new teammate and automatically creates its thread. Launch may set `model`; pass `threadName` if you want a stable name, or omit it to let AgentSymphony generate one. If `prompt` is supplied, it is delivered as the first hub message with AgentSymphony wrappers after registration, not as raw startup input.
- `agentsymphony_hub_resume_receiver`: resumes an offline teammate session by session id; if `processId` is supplied and still runs that session, the process is reused instead of launching a replacement. Resume may set only `variant`; it does not change the session model. If `prompt` is supplied, it is delivered through the hub after resume.
- `agentsymphony_hub_system_status`: shows this instance, live peers, visible threads, queued counts, and suggested next tools.
- `agentsymphony_hub_send_thread`: sends to a visible thread by thread name, resolving routing automatically. Message delivery may set only `variant`; it does not change the receiver model.
- `agentsymphony_hub_reply`: replies to the latest inbound hub-routed thread, or a named thread. Replies may set only `variant`; they do not change the receiver model.
- `agentsymphony_hub_list_threads` and `agentsymphony_hub_read_thread`: inspect visible hub threads and recent message history on demand. These tools are not for polling or receiving new messages; normal hub messages are injected automatically into the target session.
- `agentsymphony_hub_delete_teammate`: deletes a stale offline teammate visible to the current session. Related hub threads and messages are removed automatically; live teammates and unrelated instances are rejected.

Tool results use a consistent JSON envelope with `ok`, `type`, `summary`, and `data` fields so parent agents can quickly decide what happened before inspecting details.

## Teammate Windows

`agentsymphony_hub_launch_receiver` opens a teammate OpenCode session in a terminal and automatically creates its hub thread. Follow-up work should use `agentsymphony_hub_send_thread`; replies arrive through injected hub messages.

By default AgentSymphony tries common Linux terminal launchers such as `xdg-terminal-exec`, `ghostty`, `kitty`, `wezterm`, `alacritty`, `gnome-terminal`, `konsole`, and `xfce4-terminal`.

Use `AGENTSYMPHONY_TERMINAL` to override the launch command. Supported placeholders are `{sessionId}`, `{title}`, `{directory}`, and `{command}`. Example:

```sh
AGENTSYMPHONY_TERMINAL="ghostty --title {title} -e {command}"
```

## Local State

Conversation metadata and message history are stored under `.agentsymphony/` in the active project directory. This directory is intentionally ignored by git.

## Model Catalog

AgentSymphony does not hard-code model quality assumptions. Model names and capabilities change faster than model training data, so configure the current choices in `agentsymphony.models.json` at the project root or `~/.config/opencode/agentsymphony/models.json`:

```json
{
  "models": [
    {
      "id": "provider/model-id",
      "label": "Fast current model",
      "strengths": ["low latency", "cheap"],
      "bestFor": ["smoke tests", "formatting", "narrow lookup"],
      "avoidFor": ["architecture review", "ambiguous debugging"],
      "notes": "Keep this description current as providers change."
    }
  ]
}
```

Set `AGENTSYMPHONY_MODEL_CATALOG=/path/to/models.json` to override both default locations. The catalog is injected into the team system guidance so agents choose a model from current configuration instead of relying on stale built-in knowledge.

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

## NPM Package And Global Install

Build a distributable package locally:

```sh
npm pack
```

Install the generated tarball globally:

```sh
npm install -g ./agentsymphony-0.1.0.tgz
```

Global commands:

- `agentsymphony-hub`: starts the hub daemon on `127.0.0.1:4777` by default.
- `agentsymphony-plugin-path`: prints the absolute path to the packaged OpenCode plugin entrypoint.

Configure OpenCode to load the global plugin by adding the printed path to `opencode.json`:

```sh
agentsymphony-plugin-path
```

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/from/agentsymphony-plugin-path"]
}
```

Then run the hub and restart OpenCode:

```sh
agentsymphony-hub
```
