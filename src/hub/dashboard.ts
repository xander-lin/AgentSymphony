export function renderHubDashboard(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentSymphony Hub</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #070911; color: #edf2ff; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 18% 0%, rgba(79, 70, 229, 0.24), transparent 28rem), radial-gradient(circle at 90% 20%, rgba(14, 165, 233, 0.14), transparent 24rem), #070911; }
    main { max-width: 1440px; margin: 0 auto; padding: 28px 18px 42px; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    h1 { margin: 0; font-size: clamp(30px, 5vw, 56px); letter-spacing: -0.06em; }
    .muted { color: #94a3b8; }
    .pill { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 6px 11px; background: rgba(15, 23, 42, 0.82); border: 1px solid #25324a; color: #dbeafe; font-size: 13px; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0; }
    .stat { border: 1px solid #25324a; border-radius: 18px; padding: 14px 16px; background: rgba(11, 18, 32, 0.72); box-shadow: 0 18px 60px rgba(0,0,0,.25); }
    .stat span { color: #93a4be; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .stat strong { display: block; font-size: 28px; letter-spacing: -0.04em; margin-top: 4px; }
    .stage { position: relative; min-height: 620px; border: 1px solid #25324a; border-radius: 28px; overflow: hidden; background: linear-gradient(180deg, rgba(15, 23, 42, .78), rgba(8, 13, 25, .88)); box-shadow: 0 30px 100px rgba(0,0,0,.36); }
    #links { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; }
    .graph { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(240px, 1fr) minmax(320px, 1.25fr) minmax(240px, 1fr); gap: 28px; padding: 28px; }
    .lane { min-width: 0; }
    .lane-title { color: #c7d2fe; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; margin: 0 0 12px; }
    .stack { display: flex; flex-direction: column; gap: 14px; }
    .instance-node, .thread-card { border: 1px solid #2a3852; border-radius: 22px; background: rgba(13, 21, 36, .94); box-shadow: 0 18px 52px rgba(0,0,0,.32); }
    .instance-node { padding: 16px; min-height: 86px; }
    .thread-card { padding: 18px; min-height: 124px; position: relative; }
    .instance-node.live { border-color: rgba(52, 211, 153, .55); }
    .instance-name { font-weight: 750; letter-spacing: -0.02em; overflow-wrap: anywhere; }
    .instance-meta, .thread-meta { margin-top: 8px; color: #93a4be; font-size: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
    code { color: #a5b4fc; background: #111827; padding: 2px 7px; border-radius: 8px; }
    .thread-name { font-size: 22px; font-weight: 800; letter-spacing: -0.04em; overflow-wrap: anywhere; }
    .thread-title { margin-top: 4px; color: #cbd5e1; }
    .badges { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
    .badge { border-radius: 999px; padding: 4px 9px; font-size: 12px; border: 1px solid #334155; background: #111827; color: #dbeafe; }
    .queued { color: #fbbf24; } .delivered { color: #60a5fa; } .acknowledged { color: #34d399; }
    .empty { color: #94a3b8; border: 1px dashed #334155; border-radius: 18px; padding: 18px; background: rgba(15, 23, 42, .38); }
    .recent { margin-top: 18px; border: 1px solid #25324a; border-radius: 22px; overflow: hidden; background: rgba(11, 18, 32, .74); }
    .recent h2 { margin: 0; padding: 14px 18px; border-bottom: 1px solid #25324a; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: #c7d2fe; }
    .message-list { display: grid; gap: 0; }
    .message { display: grid; grid-template-columns: 120px 180px 1fr; gap: 12px; padding: 12px 18px; border-bottom: 1px solid #172033; font-size: 13px; }
    .message:last-child { border-bottom: 0; }
    .content { color: #dbeafe; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @media (max-width: 980px) { .graph { grid-template-columns: 1fr; } #links { display: none; } .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } .message { grid-template-columns: 1fr; } header { align-items: start; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div><h1>AgentSymphony Hub</h1><div class="muted">Conversation graph for OpenCode instance collaboration</div></div>
      <div class="pill">Auto refresh <span id="updated">never</span></div>
    </header>
    <section class="stats">
      <div class="stat"><span>Live Instances</span><strong id="stat-instances">0</strong></div>
      <div class="stat"><span>Threads</span><strong id="stat-conversations">0</strong></div>
      <div class="stat"><span>Messages</span><strong id="stat-messages">0</strong></div>
      <div class="stat"><span>Queued</span><strong id="stat-queued">0</strong></div>
    </section>
    <section class="stage" id="stage">
      <svg id="links"></svg>
      <div class="graph">
        <div class="lane"><h2 class="lane-title">Creator Instances</h2><div class="stack" id="parents"></div></div>
        <div class="lane"><h2 class="lane-title">Conversation Cards</h2><div class="stack" id="threads"></div></div>
        <div class="lane"><h2 class="lane-title">Target Instances</h2><div class="stack" id="targets"></div></div>
      </div>
    </section>
    <section class="recent"><h2>Recent Message Flow</h2><div class="message-list" id="messages"></div></section>
  </main>
  <script>
    const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    const short = (value) => String(value ?? '').slice(0, 12);
    const fmt = (value) => value ? new Date(value).toLocaleTimeString() : '';
    const byId = (items) => Object.fromEntries(items.map((item) => [item.id, item]));
    function instanceCard(instance, role) {
      if (!instance) return '<div class="empty">Missing instance</div>';
      return '<article class="instance-node live" data-node="' + esc(role + ':' + instance.id) + '"><div class="instance-name">' + esc(instance.name) + '</div><div class="instance-meta"><code>' + esc(short(instance.id)) + '</code><span>seen ' + esc(fmt(instance.lastSeenAt)) + '</span></div></article>';
    }
    function threadCard(conversation, messages) {
      const related = messages.filter((m) => m.conversationId === conversation.id);
      const queued = related.filter((m) => m.status === 'queued').length;
      const acked = related.filter((m) => m.status === 'acknowledged').length;
      return '<article class="thread-card" data-thread="' + esc(conversation.id) + '"><div class="thread-name">' + esc(conversation.threadName) + '</div><div class="thread-title">' + esc(conversation.title) + '</div><div class="thread-meta"><code>' + esc(short(conversation.id)) + '</code><span>updated ' + esc(fmt(conversation.updatedAt)) + '</span></div><div class="badges"><span class="badge">' + related.length + ' messages</span><span class="badge queued">' + queued + ' queued</span><span class="badge acknowledged">' + acked + ' ack</span></div></article>';
    }
    function drawLinks(snapshot) {
      const svg = document.getElementById('links');
      const stage = document.getElementById('stage').getBoundingClientRect();
      const path = (from, to, cls) => {
        if (!from || !to) return '';
        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const x1 = a.right - stage.left;
        const y1 = a.top + a.height / 2 - stage.top;
        const x2 = b.left - stage.left;
        const y2 = b.top + b.height / 2 - stage.top;
        const mid = Math.max(60, Math.abs(x2 - x1) / 2);
        return '<path class="' + cls + '" d="M ' + x1 + ' ' + y1 + ' C ' + (x1 + mid) + ' ' + y1 + ', ' + (x2 - mid) + ' ' + y2 + ', ' + x2 + ' ' + y2 + '" fill="none" stroke="rgba(129,140,248,.62)" stroke-width="2" />';
      };
      svg.setAttribute('viewBox', '0 0 ' + stage.width + ' ' + stage.height);
      svg.innerHTML = snapshot.conversations.map((c) => {
        const creator = document.querySelector('[data-node="creator:' + c.createdByInstanceId + '"]');
        const target = document.querySelector('[data-node="target:' + c.targetInstanceId + '"]');
        const thread = document.querySelector('[data-thread="' + c.id + '"]');
        return path(creator, thread, 'creator-link') + path(thread, target, 'target-link');
      }).join('');
    }
    async function refresh() {
      const snapshot = await fetch('/monitor/snapshot').then((r) => r.json());
      const instances = byId(snapshot.instances);
      const creatorIds = [...new Set(snapshot.conversations.map((c) => c.createdByInstanceId))];
      const targetIds = [...new Set(snapshot.conversations.map((c) => c.targetInstanceId))];
      document.getElementById('updated').textContent = new Date().toLocaleTimeString();
      document.getElementById('stat-instances').textContent = snapshot.instances.length;
      document.getElementById('stat-conversations').textContent = snapshot.conversations.length;
      document.getElementById('stat-messages').textContent = snapshot.messages.length;
      document.getElementById('stat-queued').textContent = snapshot.messages.filter((m) => m.status === 'queued').length;
      document.getElementById('parents').innerHTML = creatorIds.length ? creatorIds.map((id) => instanceCard(instances[id], 'creator')).join('') : '<div class="empty">No creator instances yet</div>';
      document.getElementById('threads').innerHTML = snapshot.conversations.length ? snapshot.conversations.map((c) => threadCard(c, snapshot.messages)).join('') : '<div class="empty">No conversation cards yet</div>';
      document.getElementById('targets').innerHTML = targetIds.length ? targetIds.map((id) => instanceCard(instances[id], 'target')).join('') : '<div class="empty">No target instances yet</div>';
      document.getElementById('messages').innerHTML = snapshot.messages.slice(0, 8).map((m) => { const c = snapshot.conversations.find((item) => item.id === m.conversationId); return '<div class="message"><span class="' + esc(m.status) + '">' + esc(m.status) + '</span><span>' + esc(c?.threadName ?? short(m.conversationId)) + '</span><span class="content">' + esc(m.content).slice(0, 220) + '</span></div>'; }).join('') || '<div class="message"><span class="muted">No messages yet</span></div>';
      requestAnimationFrame(() => drawLinks(snapshot));
    }
    refresh().catch(console.error);
    setInterval(() => refresh().catch(console.error), 1500);
    addEventListener('resize', () => refresh().catch(console.error));
  </script>
</body>
</html>`
}
