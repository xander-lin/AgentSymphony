# AgentSymphony

AgentSymphony 是一个 OpenCode 团队协作插件。它让一个 OpenCode 会话（队长）可以启动和协调其他 OpenCode 会话（队员）作为独立的交互式 agent。

核心设计：**hub 做消息中继，队员管理在本地执行**。多机协作通过共享 hub daemon 实现，所有 teammate 全程在本地 TUI 窗口可见。

---

## 特性

| 特性 | 说明 |
|------|------|
| **多模型团队** | 队员可使用不同提供商/模型并行工作 |
| **N:1 对话** | 同一对实例可建多个独立线程 |
| **自动杀进程** | delete 时自动找 PID 杀进程再删 hub 记录 |
| **resume** | kill 旧进程 → 确认离线 → spawn 新进程，线程保留 |
| **重复启动防御** | 已有在线队员时拒绝 launch，引导 delete/resume |
| **hub 鉴权** | deleteInstance 校验 caller 是否为 conversation 参与方 |
| **配置化 hub URL** | 读 `~/.config/opencode/agentsymphony/config.json` |
| **SQLite 存储** | 替代 JSON 文件，崩溃安全 |
| **多 target 构建** | plugin/daemon 分离编译 |
| **Web Dashboard** | 拖拽连线、消息查看、状态监控 |

---

## 快速开始

### 1. 安装依赖

```sh
npm install
npm run build              # 构建 plugin + daemon + dashboard
```

### 2. 启动 hub daemon

```sh
systemctl --user enable --now agentsymphony-hub
```

hub 监听 `127.0.0.1:4777`，启动后可以打开 http://127.0.0.1:4777/ 查看 dashboard。

### 3. 配置 OpenCode

在 `~/.config/opencode/opencode.json` 中添加 plugin 路径：

```json
{
  "plugin": ["/home/你的用户名/.opencode/lib/node_modules/agentsymphony/dist/plugin.js"]
}
```

### 4. 配置本地 hub URL

```json
// ~/.config/opencode/agentsymphony/config.json
{ "hubUrl": "http://127.0.0.1:4777" }
```

### 5. 启动队长

```sh
opencode
```

加载 plugin 后自动连上 hub。用 `agentsymphony_hub_launch_receiver` 召集队员。

---

## 工具

| 工具 | 说明 |
|------|------|
| `agentsymphony_hub_launch_receiver` | 启动一个新队员（本地 TUI 窗口），自动创建对话线程 |
| `agentsymphony_hub_resume_receiver` | 杀旧进程 + spawn 新进程重启队员，线程历史保留 |
| `agentsymphony_hub_delete_teammate` | 杀进程（本地）/删记录（远程），清理线程和消息 |
| `agentsymphony_hub_send_thread` | 按线程名发送任务 |
| `agentsymphony_hub_reply` | 回复最新或指定线程。**必须用此工具**——文字输出只会到自己的终端 |
| `agentsymphony_hub_system_status` | 查看在线队员、线程、离线警告 |
| `agentsymphony_hub_list_threads` | 查看可见线程列表 |
| `agentsymphony_hub_read_thread` | 查看线程消息历史 |

所有工具返回统一 JSON 格式：`{ ok, type, summary, data }`。

---

## 工作流程

### 单机团队

1. 队长（你）启动 opencode
2. 用 `agentsymphony_hub_launch_receiver` 召集队员（不同模型）
3. 每个队员在独立 TUI 窗口中运行
4. 队长通过 `agentsymphony_hub_send_thread` 分配任务
5. 队员用 `agentsymphony_hub_reply` 回复结果
6. 完成后用 `agentsymphony_hub_delete_teammate` 清理

### 双组长模式

队长 A（本机）和队长 B（远程）通过同一 hub 连接。各自管理自己的队员，互相通信协调。

---

## 配置

### Hub Daemon

通过 systemd unit 配置环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AGENTSYMPHONY_HUB_PORT` | `4777` | 监听端口 |
| `AGENTSYMPHONY_HUB_HOST` | `127.0.0.1` | 监听地址（多机设为 `0.0.0.0`） |
| `AGENTSYMPHONY_INSTANCE_TTL_MS` | `3000` | 实例心跳超时 |
| `AGENTSYMPHONY_MESSAGE_TTL_MS` | `86400000` | 消息自动清理时间（24h） |
| `AGENTSYMPHONY_HUB_STORE` | `hub-store.db` | 存储路径（`.db`=SQLite, `.json`=JSON） |

```sh
systemctl --user edit agentsymphony-hub
# 在 [Service] 段添加：
# Environment=AGENTSYMPHONY_HUB_HOST=0.0.0.0
```

### 客户端 hubUrl

```json
// ~/.config/opencode/agentsymphony/config.json
{ "hubUrl": "http://服务器IP:4777" }
```

如不配置，默认连 `http://127.0.0.1:4777`。

### 终端启动器

```sh
AGENTSYMPHONY_TERMINAL="ghostty --title {title} -e {command}"
```

默认使用 `kitty`。支持占位符：`{sessionId}`、`{title}`、`{directory}`、`{command}`。

### 模型目录

在 `~/.config/opencode/agentsymphony/models.json` 中配置：

```json
{
  "models": [
    {
      "id": "deepseek/deepseek-v4-flash",
      "label": "DeepSeek V4 Flash",
      "strengths": ["fast", "cheap"],
      "bestFor": ["smoke tests", "quick tasks"],
      "avoidFor": ["architecture review"]
    }
  ]
}
```

---

## 多机部署

### 架构

```
机器 A (hub 服务器)
   ├── hub daemon (systemd)
   └── OpenCode + plugin (队长)

机器 B (队员)
   └── OpenCode + plugin (hubUrl → 机器 A)
```

### Hub 机设置

```sh
systemctl --user enable --now agentsymphony-hub
systemctl --user edit agentsymphony-hub
# 添加: Environment=AGENTSYMPHONY_HUB_HOST=0.0.0.0
systemctl --user daemon-reload && systemctl --user restart agentsymphony-hub
```

放开防火墙端口 4777。

### 队员机设置

在本机打包安装：

```sh
npm run build && npm pack                     # agentsymphony-0.1.0.tgz
scp agentsymphony-0.1.0.tgz user@远程机:~/
```

在远程机：

```sh
npm install -g --prefix ~/.opencode ./agentsymphony-0.1.0.tgz
mkdir -p ~/.config/opencode/agentsymphony
echo '{"hubUrl":"http://<hub-ip>:4777"}' > ~/.config/opencode/agentsymphony/config.json
```

同步 AGENTS.md 到远程机：

```sh
scp ~/.config/opencode/AGENTS.md user@远程机:~/.config/opencode/AGENTS.md
```

在 `~/.config/opencode/opencode.json` 中添加 plugin 路径，启动 opencode 自动连 hub。

---

## 架构原则

代码遵循模块化、接口驱动设计：

| 原则 | 状态 |
|------|------|
| 每接口至少两个实现（real + mock） | 完全合规 |
| 接口跟模块走 | 部分合规 |
| mock 优先开发 | 部分合规 |
| 构建时可选择模块 | 多 tsconfig target |
| 存储后端可选 | SQLite / JSON file |

---

## 开发

```sh
npm install
npm run verify            # typecheck + build + test
npm run build             # 全量构建
npm run build:plugin      # 只构建 plugin
npm run build:daemon      # 只构建 daemon
npm test                  # 运行测试
```

### 构建目标

| Target | Config | 产物 |
|--------|--------|------|
| plugin | `tsconfig.plugin.json` | OpenCode 插件 |
| daemon | `tsconfig.daemon.json` | Hub 守护进程 |
| full | `tsconfig.build.json` | 全量编译 |
