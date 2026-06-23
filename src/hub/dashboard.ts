export function renderHubDashboard(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentSymphony Hub</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #070911; color: #edf2ff; font-family: ui-sans-serif, system-ui, sans-serif; }
    main { max-width: 680px; padding: 32px; border: 1px solid #25324a; border-radius: 24px; background: rgba(15, 23, 42, .82); box-shadow: 0 24px 80px rgba(0,0,0,.42); }
    h1 { margin: 0 0 12px; font-size: 42px; letter-spacing: -0.06em; }
    code { color: #a5b4fc; background: #111827; padding: 2px 7px; border-radius: 8px; }
  </style>
</head>
<body>
  <main>
    <h1>AgentSymphony Hub</h1>
    <p>The React Flow dashboard has not been built yet.</p>
    <p>Run <code>npm run dashboard:build</code>, then refresh this page.</p>
  </main>
</body>
</html>`
}
