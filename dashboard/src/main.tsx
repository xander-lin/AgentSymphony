import "@xyflow/react/dist/style.css"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import ELK from "elkjs/lib/elk.bundled.js"
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react"
import "./styles.css"

interface HubInstance {
  id: string
  name: string
  directory: string
  lastSeenAt: string
}

interface HubConversation {
  id: string
  threadName: string
  title: string
  createdByInstanceId: string
  parentInstanceId: string
  targetInstanceId: string
  updatedAt: string
}

interface HubMessage {
  id: string
  conversationId: string
  fromInstanceId: string
  toInstanceId: string
  content: string
  createdAt: string
  status: "queued" | "delivered" | "acknowledged"
}

interface MonitorSnapshot {
  instances: HubInstance[]
  conversations: HubConversation[]
  messages: HubMessage[]
}

type GraphNodeData =
  | { kind: "instance"; instance: HubInstance }
  | { kind: "thread"; conversation: HubConversation; messages: HubMessage[] }

const elk = new (ELK as any)()

function short(value: string): string {
  return value.slice(0, 12)
}

function formatTime(value: string): string {
  if (!value) return "unknown"
  return new Date(value).toLocaleTimeString()
}

function instanceLabel(instancesById: Map<string, HubInstance>, id: string): string {
  return instancesById.get(id)?.name ?? `Missing ${short(id)}`
}

function AgentNode({ data }: NodeProps<Node<GraphNodeData>>) {
  if (data.kind !== "instance") return null
  return (
    <div className="node-card instance-card">
      <Handle type="target" position={Position.Left} className="node-handle target-handle" />
      <Handle type="source" position={Position.Right} className="node-handle source-handle" />
      <div className="eyebrow">OpenCode Instance</div>
      <div className="node-title">{data.instance.name}</div>
      <div className="node-meta"><code>{short(data.instance.id)}</code><span>{formatTime(data.instance.lastSeenAt)}</span></div>
    </div>
  )
}

function ThreadNode({ data }: NodeProps<Node<GraphNodeData>>) {
  if (data.kind !== "thread") return null
  const queued = data.messages.filter((message) => message.status === "queued").length
  const acknowledged = data.messages.filter((message) => message.status === "acknowledged").length
  return (
    <div className="node-card thread-card">
      <Handle type="target" position={Position.Left} className="node-handle target-handle" />
      <Handle type="source" position={Position.Right} className="node-handle source-handle" />
      <div className="eyebrow">Conversation Card</div>
      <div className="thread-name">{data.conversation.threadName}</div>
      <div className="thread-title">{data.conversation.title}</div>
      <div className="node-meta"><code>{short(data.conversation.id)}</code><span>{formatTime(data.conversation.updatedAt)}</span></div>
      <div className="badges"><span>{data.messages.length} messages</span><span className="queued">{queued} queued</span><span className="acknowledged">{acknowledged} ack</span></div>
    </div>
  )
}

const nodeTypes = { instance: AgentNode, thread: ThreadNode }

async function fetchSnapshot(): Promise<MonitorSnapshot> {
  const response = await fetch("/monitor/snapshot")
  if (!response.ok) throw new Error(`Failed to fetch snapshot: ${response.status}`)
  return response.json()
}

function buildGraph(snapshot: MonitorSnapshot): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
  const instanceIds = new Set(snapshot.instances.map((instance) => instance.id))
  for (const conversation of snapshot.conversations) {
    instanceIds.add(conversation.parentInstanceId)
    instanceIds.add(conversation.targetInstanceId)
  }
  const instancesById = new Map(snapshot.instances.map((instance) => [instance.id, instance]))
  const nodes: Node<GraphNodeData>[] = []
  for (const id of instanceIds) {
    const instance = instancesById.get(id) ?? { id, name: `Missing ${short(id)}`, directory: "", lastSeenAt: "" }
    nodes.push({ id: `instance:${id}`, type: "instance", position: { x: 0, y: 0 }, sourcePosition: Position.Right, targetPosition: Position.Left, data: { kind: "instance", instance } })
  }
  for (const conversation of snapshot.conversations) {
    nodes.push({
      id: `thread:${conversation.id}`,
      type: "thread",
      position: { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { kind: "thread", conversation, messages: snapshot.messages.filter((message) => message.conversationId === conversation.id) },
    })
  }
  const edges: Edge[] = snapshot.conversations.flatMap((conversation) => [
    {
      id: `creator:${conversation.id}`,
      source: `instance:${conversation.createdByInstanceId}`,
      target: `thread:${conversation.id}`,
      type: "smoothstep",
      animated: true,
      className: "creator-edge",
      interactionWidth: 22,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#a5b4fc", width: 18, height: 18 },
      style: { stroke: "#a5b4fc", strokeWidth: 4 },
    },
    {
      id: `target:${conversation.id}`,
      source: `thread:${conversation.id}`,
      target: `instance:${conversation.targetInstanceId}`,
      type: "smoothstep",
      animated: conversation.updatedAt === snapshot.conversations[0]?.updatedAt,
      className: "target-edge",
      interactionWidth: 22,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#38bdf8", width: 18, height: 18 },
      style: { stroke: "#38bdf8", strokeWidth: 4 },
    },
  ])
  return { nodes, edges }
}

async function layoutGraph(nodes: Node<GraphNodeData>[], edges: Edge[]): Promise<Node<GraphNodeData>[]> {
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "90",
      "elk.layered.spacing.nodeNodeBetweenLayers": "160",
    },
    children: nodes.map((node) => ({ id: node.id, width: node.type === "thread" ? 340 : 280, height: node.type === "thread" ? 168 : 118 })),
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  }
  const layout = await elk.layout(graph)
  const positions = new Map<string, { x: number; y: number }>((layout.children ?? []).map((node: any) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]))
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }))
}

function ContextMenu({ menu, onClose, onInspect, onFocusNode, onCopyThread }: {
  menu: { x: number; y: number; node: Node<GraphNodeData> } | null
  onClose: () => void
  onInspect: (node: Node<GraphNodeData>) => void
  onFocusNode: (nodeId: string) => void
  onCopyThread: (node: Node<GraphNodeData>) => void
}) {
  if (!menu) return null
  const data = menu.node.data
  return (
    <div className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseLeave={onClose}>
      <button type="button" onClick={() => onInspect(menu.node)}>Inspect</button>
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(menu.node.id); onClose() }}>Copy Node ID</button>
      {data.kind === "thread" && <button type="button" onClick={() => onCopyThread(menu.node)}>Copy Thread Name</button>}
      {data.kind === "thread" && <button type="button" onClick={() => onFocusNode(`instance:${data.conversation.createdByInstanceId}`)}>Focus Creator</button>}
      {data.kind === "thread" && <button type="button" onClick={() => onFocusNode(`instance:${data.conversation.targetInstanceId}`)}>Focus Target</button>}
      {data.kind === "thread" && <button type="button" onClick={() => onInspect(menu.node)}>View Messages</button>}
    </div>
  )
}

function DetailsDrawer({ node, instancesById, onClose }: { node: Node<GraphNodeData> | null; instancesById: Map<string, HubInstance>; onClose: () => void }) {
  if (!node) return null
  if (node.data.kind === "thread") {
    const { conversation, messages } = node.data
    return (
      <aside className="drawer">
        <button type="button" className="close" onClick={onClose}>Close</button>
        <h2>{conversation.threadName}</h2>
        <p className="muted">{conversation.title}</p>
        <dl className="facts">
          <div><dt>Creator</dt><dd>{instanceLabel(instancesById, conversation.createdByInstanceId)} <code>{short(conversation.createdByInstanceId)}</code></dd></div>
          <div><dt>Target</dt><dd>{instanceLabel(instancesById, conversation.targetInstanceId)} <code>{short(conversation.targetInstanceId)}</code></dd></div>
          <div><dt>Updated</dt><dd>{formatTime(conversation.updatedAt)}</dd></div>
        </dl>
        <div className="message-stack">
          {messages.length ? messages.map((message) => {
            const side = message.fromInstanceId === conversation.createdByInstanceId ? "right" : "left"
            return (
              <article className={`message ${side}`} key={message.id}>
                <div className="message-speaker">{instanceLabel(instancesById, message.fromInstanceId)} <time>{formatTime(message.createdAt)}</time></div>
                <p>{message.content}</p>
                <div className="message-footer"><span className={message.status}>{message.status}</span><code>{short(message.id)}</code></div>
              </article>
            )
          }) : <p className="muted">No messages yet.</p>}
        </div>
      </aside>
    )
  }
  return (
    <aside className="drawer">
      <button type="button" className="close" onClick={onClose}>Close</button>
      <h2>{node.data.instance.name}</h2>
      <p className="muted">{node.data.instance.directory}</p>
      <code>{node.data.instance.id}</code>
    </aside>
  )
}

function Dashboard() {
  const flow = useReactFlow<Node<GraphNodeData>, Edge>()
  const [snapshot, setSnapshot] = useState<MonitorSnapshot>({ instances: [], conversations: [], messages: [] })
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<GraphNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [menu, setMenu] = useState<{ x: number; y: number; node: Node<GraphNodeData> } | null>(null)
  const [selected, setSelected] = useState<Node<GraphNodeData> | null>(null)

  const refresh = useCallback(async () => {
    const next = await fetchSnapshot()
    const graph = buildGraph(next)
    const laidOut = await layoutGraph(graph.nodes, graph.edges)
    setSnapshot(next)
    setNodes(laidOut)
    setEdges(graph.edges)
  }, [setEdges, setNodes])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 1500)
    return () => clearInterval(timer)
  }, [refresh])

  const queued = useMemo(() => snapshot.messages.filter((message) => message.status === "queued").length, [snapshot.messages])
  const instancesById = useMemo(() => new Map(snapshot.instances.map((instance) => [instance.id, instance])), [snapshot.instances])

  const focusNode = useCallback((nodeId: string) => {
    const node = flow.getNode(nodeId)
    if (!node) return
    flow.setCenter(node.position.x + (node.type === "thread" ? 170 : 140), node.position.y + (node.type === "thread" ? 84 : 59), { zoom: 1.2, duration: 500 })
    setMenu(null)
  }, [flow])

  const copyThread = useCallback((node: Node<GraphNodeData>) => {
    if (node.data.kind === "thread") void navigator.clipboard?.writeText(node.data.conversation.threadName)
    setMenu(null)
  }, [])

  return (
    <div className="app">
      <header className="hud">
        <div><h1>AgentSymphony Hub</h1><p>Auto-layout infinite canvas for OpenCode collaboration</p></div>
        <div className="stats"><span>Instances <b>{snapshot.instances.length}</b></span><span>Threads <b>{snapshot.conversations.length}</b></span><span>Messages <b>{snapshot.messages.length}</b></span><span>Queued <b>{queued}</b></span></div>
      </header>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => setSelected(node)}
        onNodeContextMenu={(event, node) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, node }) }}
        fitView
        minZoom={0.1}
        maxZoom={2.5}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} onFocusNode={focusNode} onCopyThread={copyThread} onInspect={(node) => { setSelected(node); setMenu(null) }} />
      <DetailsDrawer node={selected} instancesById={instancesById} onClose={() => setSelected(null)} />
    </div>
  )
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><ReactFlowProvider><Dashboard /></ReactFlowProvider></React.StrictMode>)
