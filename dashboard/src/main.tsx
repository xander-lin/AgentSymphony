import "@xyflow/react/dist/style.css"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  online?: boolean
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
  | { kind: "relationship"; relationship: ConversationRelationship; messages: HubMessage[] }

interface ConversationRelationship {
  id: string
  createdByInstanceId: string
  targetInstanceId: string
  conversations: HubConversation[]
  updatedAt: string
}

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
  const online = data.instance.online !== false
  return (
    <div className={`node-card instance-card ${online ? "online" : "offline"}`}>
      <Handle type="target" position={Position.Left} className="node-handle target-handle" />
      <Handle type="source" position={Position.Right} className="node-handle source-handle" />
      <div className="eyebrow">OpenCode Instance · {online ? "Online" : "Offline"}</div>
      <div className="node-title">{data.instance.name}</div>
      <div className="node-meta"><code>{short(data.instance.id)}</code><span>{formatTime(data.instance.lastSeenAt)}</span></div>
    </div>
  )
}

function RelationshipNode({ data }: NodeProps<Node<GraphNodeData>>) {
  if (data.kind !== "relationship") return null
  const queued = data.messages.filter((message) => message.status === "queued").length
  const acknowledged = data.messages.filter((message) => message.status === "acknowledged").length
  const latest = data.relationship.conversations[0]
  return (
    <div className="node-card thread-card">
      <Handle type="target" position={Position.Left} className="node-handle target-handle" />
      <Handle type="source" position={Position.Right} className="node-handle source-handle" />
      <div className="eyebrow">Conversation Link</div>
      <div className="thread-name">{data.relationship.conversations.length} threads</div>
      <div className="thread-title">Latest: {latest?.threadName ?? "none"}</div>
      <div className="node-meta"><code>{short(data.relationship.id)}</code><span>{formatTime(data.relationship.updatedAt)}</span></div>
      <div className="badges"><span>{data.messages.length} messages</span><span className="queued">{queued} queued</span><span className="acknowledged">{acknowledged} ack</span></div>
    </div>
  )
}

const nodeTypes = { instance: AgentNode, relationship: RelationshipNode }

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
    const instance = instancesById.get(id) ?? { id, name: `Missing ${short(id)}`, directory: "", lastSeenAt: "", online: false }
    nodes.push({ id: `instance:${id}`, type: "instance", position: { x: 0, y: 0 }, sourcePosition: Position.Right, targetPosition: Position.Left, data: { kind: "instance", instance } })
  }
  const relationships = groupRelationships(snapshot.conversations)
  for (const relationship of relationships) {
    nodes.push({
      id: `relationship:${relationship.id}`,
      type: "relationship",
      position: { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { kind: "relationship", relationship, messages: snapshot.messages.filter((message) => relationship.conversations.some((conversation) => conversation.id === message.conversationId)) },
    })
  }
  const edges: Edge[] = relationships.flatMap((relationship) => [
    {
      id: `creator:${relationship.id}`,
      source: `instance:${relationship.createdByInstanceId}`,
      target: `relationship:${relationship.id}`,
      type: "smoothstep",
      animated: true,
      className: "creator-edge",
      interactionWidth: 22,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#a5b4fc", width: 18, height: 18 },
      style: { stroke: "#a5b4fc", strokeWidth: 4 },
    },
    {
      id: `target:${relationship.id}`,
      source: `relationship:${relationship.id}`,
      target: `instance:${relationship.targetInstanceId}`,
      type: "smoothstep",
      animated: relationship.updatedAt === relationships[0]?.updatedAt,
      className: "target-edge",
      interactionWidth: 22,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#38bdf8", width: 18, height: 18 },
      style: { stroke: "#38bdf8", strokeWidth: 4 },
    },
  ])
  return { nodes, edges }
}

function groupRelationships(conversations: HubConversation[]): ConversationRelationship[] {
  const groups = new Map<string, HubConversation[]>()
  for (const conversation of conversations) {
    const key = `${conversation.createdByInstanceId}:${conversation.targetInstanceId}`
    groups.set(key, [...groups.get(key) ?? [], conversation])
  }
  return [...groups.entries()]
    .map(([id, groupedConversations]) => {
      const sorted = [...groupedConversations].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      return {
        id,
        createdByInstanceId: sorted[0].createdByInstanceId,
        targetInstanceId: sorted[0].targetInstanceId,
        conversations: sorted,
        updatedAt: sorted[0].updatedAt,
      }
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
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
    children: nodes.map((node) => ({ id: node.id, width: node.type === "relationship" ? 340 : 280, height: node.type === "relationship" ? 168 : 118 })),
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  }
  const layout = await elk.layout(graph)
  const positions = new Map<string, { x: number; y: number }>((layout.children ?? []).map((node: any) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]))
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }))
}

function ContextMenu({ menu, onClose, onInspect, onFocusNode, onCopyThread, onDeleteInstance, onDeleteConnections }: {
  menu: { x: number; y: number; node: Node<GraphNodeData> } | null
  onClose: () => void
  onInspect: (node: Node<GraphNodeData>) => void
  onFocusNode: (nodeId: string) => void
  onCopyThread: (node: Node<GraphNodeData>) => void
  onDeleteInstance: (node: Node<GraphNodeData>) => void
  onDeleteConnections: (node: Node<GraphNodeData>) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [menu, onClose])
  if (!menu) return null
  const data = menu.node.data
  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
      <button type="button" onClick={() => onInspect(menu.node)}>Inspect</button>
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(menu.node.id); onClose() }}>Copy Node ID</button>
      {data.kind === "instance" && <button type="button" onClick={() => { onDeleteConnections(menu.node); onClose() }}>Delete Connections</button>}
      {data.kind === "instance" && data.instance.online === false && <button type="button" className="danger" onClick={() => onDeleteInstance(menu.node)}>Delete Offline Instance</button>}
      {data.kind === "relationship" && <button type="button" onClick={() => onCopyThread(menu.node)}>Copy Latest Thread</button>}
      {data.kind === "relationship" && <button type="button" onClick={() => onFocusNode(`instance:${data.relationship.createdByInstanceId}`)}>Focus Creator</button>}
      {data.kind === "relationship" && <button type="button" onClick={() => onFocusNode(`instance:${data.relationship.targetInstanceId}`)}>Focus Target</button>}
      {data.kind === "relationship" && <button type="button" onClick={() => onInspect(menu.node)}>View Messages</button>}
    </div>
  )
}

function DetailsDrawer({ node, instancesById, conversations, onClose, onDeleteInstance }: { node: Node<GraphNodeData> | null; instancesById: Map<string, HubInstance>; conversations: HubConversation[]; onClose: () => void; onDeleteInstance: (instanceId: string) => void }) {
  if (!node) return null
  if (node.data.kind === "relationship") {
    const { relationship, messages } = node.data
    return (
      <aside className="drawer">
        <button type="button" className="close" onClick={onClose}>Close</button>
        <h2>{relationship.conversations.length} threads</h2>
        <p className="muted">{relationship.conversations.map((conversation) => conversation.threadName).join(", ")}</p>
        <dl className="facts">
          <div><dt>Creator</dt><dd>{instanceLabel(instancesById, relationship.createdByInstanceId)} <code>{short(relationship.createdByInstanceId)}</code></dd></div>
          <div><dt>Target</dt><dd>{instanceLabel(instancesById, relationship.targetInstanceId)} <code>{short(relationship.targetInstanceId)}</code></dd></div>
          <div><dt>Updated</dt><dd>{formatTime(relationship.updatedAt)}</dd></div>
        </dl>
        <div className="thread-list">
          {relationship.conversations.map((conversation) => <span key={conversation.id}>{conversation.threadName}</span>)}
        </div>
        <div className="message-stack">
          {messages.length ? [...messages].sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map((message) => {
            const side = message.fromInstanceId === relationship.createdByInstanceId ? "right" : "left"
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
  const { instance } = node.data
  const relatedConversations = conversations
    .filter((conversation) => conversation.parentInstanceId === instance.id || conversation.targetInstanceId === instance.id)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return (
    <aside className="drawer">
      <button type="button" className="close" onClick={onClose}>Close</button>
      <h2>{instance.name}</h2>
      <p className="muted">{instance.directory}</p>
      <code>{instance.id}</code>
      {instance.online === false && <button type="button" className="danger-action" onClick={() => onDeleteInstance(instance.id)}>Delete Offline Instance</button>}
      <dl className="facts">
        <div><dt>Status</dt><dd>{instance.online === false ? "Offline historical node" : "Online"}</dd></div>
        <div><dt>Last Seen</dt><dd>{formatTime(instance.lastSeenAt)}</dd></div>
      </dl>
      <h3>Related Senders</h3>
      <div className="thread-list vertical">
        {relatedConversations.length ? relatedConversations.map((conversation) => {
          const counterpartId = conversation.parentInstanceId === instance.id ? conversation.targetInstanceId : conversation.parentInstanceId
          return <span key={conversation.id}>{conversation.threadName} · {instanceLabel(instancesById, counterpartId)} · {instancesById.get(counterpartId)?.online === false ? "offline" : "online"}</span>
        }) : <p className="muted">No historical links.</p>}
      </div>
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
    flow.setCenter(node.position.x + (node.type === "relationship" ? 170 : 140), node.position.y + (node.type === "relationship" ? 84 : 59), { zoom: 1.2, duration: 500 })
    setMenu(null)
  }, [flow])

  const copyThread = useCallback((node: Node<GraphNodeData>) => {
    if (node.data.kind === "relationship") void navigator.clipboard?.writeText(node.data.relationship.conversations[0]?.threadName ?? "")
    setMenu(null)
  }, [])

  const deleteInstance = useCallback(async (instanceId: string) => {
    if (!instanceId) return
    const response = await fetch(`/instances/${encodeURIComponent(instanceId)}`, { method: "DELETE" })
    if (!response.ok) throw new Error(`Failed to delete instance: ${response.status}`)
    setSelected(null)
    setMenu(null)
    await refresh()
  }, [refresh])

  const deleteNodeInstance = useCallback((node: Node<GraphNodeData>) => {
    if (node.data.kind !== "instance") return
    void deleteInstance(node.data.instance.id)
  }, [deleteInstance])

  const deleteConnections = useCallback(async (node: Node<GraphNodeData>) => {
    if (node.data.kind !== "instance") return
    const instanceId = node.data.instance.id
    for (const conversation of snapshot.conversations) {
      if (conversation.parentInstanceId !== instanceId && conversation.targetInstanceId !== instanceId) continue
      await fetch(`/threads/${encodeURIComponent(conversation.threadName)}/archive`, { method: "POST" })
    }
    await refresh()
  }, [snapshot.conversations, refresh])

  const hasExistingConversation = useCallback((sourceId: string, targetId: string) => {
    return snapshot.conversations.some((c) =>
      (c.parentInstanceId === sourceId && c.targetInstanceId === targetId) ||
      (c.parentInstanceId === targetId && c.targetInstanceId === sourceId)
    )
  }, [snapshot.conversations])

  const isValidConnection = useCallback((connection: { source: string; target: string }) => {
    const sourceId = connection.source.startsWith("instance:") ? connection.source.slice(9) : null
    const targetId = connection.target.startsWith("instance:") ? connection.target.slice(9) : null
    if (!sourceId || !targetId) return false
    if (sourceId === targetId) return false
    if (hasExistingConversation(sourceId, targetId)) return false
    return true
  }, [hasExistingConversation])

  const onConnect = useCallback(async (params: { source: string; target: string }) => {
    const sourceId = params.source.startsWith("instance:") ? params.source.slice(9) : null
    const targetId = params.target.startsWith("instance:") ? params.target.slice(9) : null
    if (!sourceId || !targetId || sourceId === targetId || hasExistingConversation(sourceId, targetId)) return
    try {
      await fetch("/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentInstanceId: sourceId, targetInstanceId: targetId, title: `${short(sourceId)} ↔ ${short(targetId)}` }),
      })
      await refresh()
    } catch {
      // ignore connection errors
    }
  }, [refresh, hasExistingConversation])

  return (
    <div className="app">
      <header className="hud">
        <div><h1>AgentSymphony Hub</h1><p>Auto-layout infinite canvas for OpenCode collaboration</p></div>
        <div className="stats"><span>Online <b>{snapshot.instances.filter((instance) => instance.online !== false).length}</b></span><span>Known <b>{snapshot.instances.length}</b></span><span>Threads <b>{snapshot.conversations.length}</b></span><span>Messages <b>{snapshot.messages.length}</b></span><span>Queued <b>{queued}</b></span></div>
      </header>
      <div className="connect-bar">
        <span>Remote: set <code>hubUrl</code> to <code>{window.location.origin}</code> in <code>config.json</code>. Drag between instance handles to create conversations.</span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        connectionLineStyle={{ stroke: "#38bdf8", strokeWidth: 2 }}
        onNodeClick={(_, node) => setSelected(node)}
        onNodeContextMenu={(event, node) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, node }) }}
        onPaneClick={() => setMenu(null)}
        fitView
        minZoom={0.1}
        maxZoom={2.5}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} onFocusNode={focusNode} onCopyThread={copyThread} onDeleteInstance={deleteNodeInstance} onDeleteConnections={deleteConnections} onInspect={(node) => { setSelected(node); setMenu(null) }} />
      <DetailsDrawer node={selected} instancesById={instancesById} conversations={snapshot.conversations} onDeleteInstance={deleteInstance} onClose={() => setSelected(null)} />
    </div>
  )
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><ReactFlowProvider><Dashboard /></ReactFlowProvider></React.StrictMode>)
