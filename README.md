# AgentSymphony

AgentSymphony is an OpenCode-only team plugin. It lets one OpenCode session launch and coordinate teammate sessions as independent interactive agents.

Use the product as a team workflow, not as a low-level routing system: launch teammates for parallel work, send scoped tasks by thread name, and let replies arrive through normal injected messages.

## Architecture

- A top-level agent receives the real user's task and decides whether a teammate would reduce risk or latency.
- A background AgentSymphony hub stays alive and routes messages between OpenCode instances.
- Every OpenCode instance loads the AgentSymphony plugin at startup and registers with the hub.
- Parent agents start teammates; launching a teammate automatically creates the communication thread.
- A pair of OpenCode instances can have multiple parallel conversations (N:1), each with its own `threadName`.
- Messages are delivered through the hub to the target instance plugin.
- The target plugin injects incoming text into its own OpenCode session so messages show in the TUI.
- Conversations carry a `threadName`. Injected prompts show the thread name. The target agent replies with `agentsymphony_hub_reply`.

## Tools

| Tool | Description |
|------|-------------|
| `agentsymphony_hub_launch_receiver` | Start a new teammate in a TUI window. Creates the communication thread automatically. |
| `agentsymphony_hub_resume_receiver` | Kill old processes and restart a teammate by session id. Thread history preserved. |
| `agentsymphony_hub_delete_teammate` | Kill associated processes (local) or remove hub record (remote), then clean up threads and messages. |
| `agentsymphony_hub_send_thread` | Send work to an existing thread by name. |
| `agentsymphony_hub_reply` | Reply to the latest or named inbound thread. Must use this tool — plain text reaches the teammate's terminal, not the hub. |
| `agentsymphony_hub_system_status` | Inspect live teammates, threads, and offline warnings. |
| `agentsymphony_hub_list_threads` / `agentsymphony_hub_read_thread` | Inspect threads and history on demand. |

Tool results use a consistent JSON envelope with `ok`, `type`, `summary`, and `data` fields.

## Hub Daemon

The hub daemon is managed by systemd:

```sh
systemctl --user enable --now agentsymphony-hub
systemctl --user restart agentsymphony-hub
```

State is persisted to SQLite at `~/.config/opencode/agentsymphony/hub-store.db` by default. Override with `AGENTSYMPHONY_HUB_STORE`. Set to a `.json` path to use the legacy JSON file store.

Configurable via environment:

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTSYMPHONY_HUB_PORT` | `4777` | Hub HTTP port |
| `AGENTSYMPHONY_HUB_HOST` | `127.0.0.1` | Hub bind address |
| `AGENTSYMPHONY_INSTANCE_TTL_MS` | `3000` | Instance heartbeat TTL (3s) |
| `AGENTSYMPHONY_MESSAGE_TTL_MS` | `86400000` | Auto-cleanup age for acknowledged messages (24h) |
| `AGENTSYMPHONY_HUB_STORE` | `hub-store.db` | Path to hub store file |

Open `http://127.0.0.1:4777/` for the monitoring dashboard.

## Teammate Windows

Launched teammates open in a terminal window. By default, `kitty` is used. Override with `AGENTSYMPHONY_TERMINAL`:

```sh
AGENTSYMPHONY_TERMINAL="ghostty --title {title} -e {command}"
```

Supported placeholders: `{sessionId}`, `{title}`, `{directory}`, `{command}`.

## Model Catalog

Configure models in `agentsymphony.models.json` at the project root or `~/.config/opencode/agentsymphony/models.json`:

```json
{
  "models": [
    {
      "id": "provider/model-id",
      "label": "Fast current model",
      "strengths": ["low latency"],
      "bestFor": ["smoke tests"],
      "avoidFor": ["architecture review"]
    }
  ]
}
```

Set `AGENTSYMPHONY_MODEL_CATALOG` to override both default locations.

## Development

```sh
npm install
npm run verify          # typecheck + build + test
npm run build           # dashboard:build + build:plugin + build:daemon
npm run build:plugin    # plugin-only build
npm run build:daemon    # daemon-only build
```

## Build Targets

The project supports modular builds via separate tsconfig files:

| Target | Config | Description |
|--------|--------|-------------|
| plugin | `tsconfig.plugin.json` | OpenCode plugin (TUI, launcher, connector) |
| daemon | `tsconfig.daemon.json` | Hub daemon (HTTP server, storage, memory hub) |
| full | `tsconfig.build.json` | Full build for development and testing |

## Multi-machine Setup

AgentSymphony supports multi-machine collaboration through a shared hub daemon. Each machine runs its own OpenCode plugin, and they all connect to the same hub.

### Architecture

```
Machine A                      Machine B
OpenCode + plugin              OpenCode + plugin
    ↕ hubUrl: http://HUB:4777     ↕ hubUrl: http://HUB:4777
    └───────── hub daemon ────────┘
```

The hub daemon runs on one machine and relays messages between instances. Launch/resume/delete run locally on each machine — teammates always open in a visible TUI window on the machine that launched them.

### Hub Machine Setup

```sh
# Create config
mkdir -p ~/.config/opencode/agentsymphony
cat > ~/.config/opencode/agentsymphony/config.json << 'EOF'
{ "hubUrl": "http://0.0.0.0:4777" }
EOF

# Configure hub to listen on all interfaces for remote access
systemctl --user edit agentsymphony-hub
# Add: Environment=AGENTSYMPHONY_HUB_HOST=0.0.0.0

# Enable and start hub daemon
systemctl --user enable --now agentsymphony-hub
```

Ensure firewall allows inbound TCP to port 4777 from teammate machines. For production, use a reverse proxy with TLS.

### Teammate Machine Setup

Build and package the plugin on the hub machine, then install on each teammate machine:

```sh
# On hub machine
npm run build
npm pack                              # produces agentsymphony-0.1.0.tgz
scp agentsymphony-0.1.0.tgz user@machine-ip:~/

# On teammate machine
npm install -g --prefix ~/.opencode ./agentsymphony-0.1.0.tgz

# Configure hub URL
mkdir -p ~/.config/opencode/agentsymphony
echo '{"hubUrl":"http://<hub-server-ip>:4777"}' > ~/.config/opencode/agentsymphony/config.json

# Deploy team thinking flow
scp user@hub-machine:.config/opencode/AGENTS.md ~/.config/opencode/AGENTS.md
```

Add the plugin path to `~/.config/opencode/opencode.json`. Start OpenCode — the plugin connects to the hub, registers the instance, and becomes visible in the dashboard.

### Verification

A quick test script is available at `scripts/verify-multi.sh`:

```sh
# On hub machine:
systemctl --user restart agentsymphony-hub

# On two teammate machines, start OpenCode and run:
opencode --prompt "Connect to hub at $(cat ~/.config/opencode/agentsymphony/config.json | grep hubUrl | cut -d\" -f4)"
```

Open the hub dashboard at `http://<hub-server-ip>:4777/` to see connected instances and drag between handles to create conversations.

## Thinking Flow (AGENTS.md)

The project includes a `~/.config/opencode/AGENTS.md` that teaches OpenCode how to behave in team mode:

- **Identify sender**: Distinguish between real user messages and team lead `<<<AGENTSYMPHONY:...>>>` messages
- **Use the right tool**: Team lead messages must be replied to with `agentsymphony_hub_reply`, not plain text
- **Assess clarity**: Before acting, check if the request is specific enough; ask if unclear
- **Keep replies scoped**: State what was done, what was found, and what's needed next

Deploy this file to teammate machines when setting up multi-machine collaboration.

## Architecture Principles

The codebase follows pluggable, interface-driven design per `AGENTS.md`:

- Every subsystem has a defined interface with at least two implementations (real + mock).
- Interfaces live alongside their implementations, not in separate types directories.
- The hub store backend is selectable: SQLite (`SqliteHubStore`) or JSON file (`FileHubStore`).
- Mock implementations (`MockAgentSymphonyHub`, `MockHubConnector`, `MockReceiverLauncher`) serve as contract references and test foundations.
