// Server-rendered HTML for the Cartridge Exchange. Zero-dependency, inline CSS,
// matching the cartridge theme (teal/cyan). All dynamic text is HTML-escaped.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

const TRUST_COLOR = { local: '#0891b2', trusted: '#0f766e', portable: '#64748b', legacy: '#a16207', tampered: '#b91c1c' }

function layout(title, body) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Cartridge Exchange</title>
<style>
  :root { --teal:#0f766e; --cyan:#06b6d4; --ink:#083344; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#0f172a; background:#f8fafc; }
  a { color: var(--teal); text-decoration:none; } a:hover { text-decoration:underline; }
  header.top { background: linear-gradient(135deg, #0f766e, #0b3f3a); color:#fff; padding:1.1rem 1.5rem; }
  header.top .wrap { max-width:1080px; margin:0 auto; display:flex; align-items:center; gap:1rem; }
  header.top h1 { font-size:1.25rem; margin:0; letter-spacing:-0.01em; }
  header.top .tag { opacity:.85; font-size:.85rem; }
  header.top a { color:#a5f3fc; margin-left:auto; font-weight:600; }
  main { max-width:1080px; margin:1.5rem auto; padding:0 1.5rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:1.1rem; }
  .cart { background:#fff; border:1px solid #e2e8f0; border-left:5px solid var(--cyan); border-radius:14px; padding:1.1rem 1.2rem; transition:.12s; }
  .cart:hover { transform:translateY(-2px); box-shadow:0 10px 24px rgba(8,51,68,.12); }
  .cart h3 { margin:.1rem 0 .1rem; font-size:1.05rem; }
  .muted { color:#64748b; font-size:.82rem; }
  .row { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; margin:.5rem 0; }
  .badge { width:52px; height:52px; border-radius:50%; background:linear-gradient(135deg,#22d3ee,#0891b2); color:#083344; display:flex; flex-direction:column; align-items:center; justify-content:center; font-weight:800; flex:none; }
  .badge small { font-size:.5rem; font-weight:700; letter-spacing:.03em; }
  .chip { font-size:.72rem; font-weight:700; padding:.2rem .55rem; border-radius:999px; background:#ccfbf1; color:#0f766e; }
  .trust { font-size:.72rem; font-weight:700; padding:.2rem .55rem; border-radius:6px; color:#fff; }
  .rom { background:#ecfeff; color:#0e7490; border:1px solid #a5f3fc; font-weight:700; font-size:.75rem; padding:.1rem .5rem; border-radius:6px; }
  .save { background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; font-weight:700; font-size:.75rem; padding:.1rem .5rem; border-radius:6px; }
  .btn { display:inline-block; background:var(--teal); color:#fff; font-weight:600; padding:.5rem .9rem; border-radius:8px; font-size:.85rem; }
  .btn.ghost { background:#fff; color:var(--teal); border:1px solid var(--teal); }
  table { border-collapse:collapse; width:100%; font-size:.85rem; }
  td, th { text-align:left; padding:.4rem .6rem; border-bottom:1px solid #e2e8f0; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { background:#0b3f3a; color:#d1fae5; padding:1rem; border-radius:10px; overflow:auto; font-size:.8rem; }
  .verified { color:#0f766e; font-weight:700; } .unproven { color:#94a3b8; }
  footer { max-width:1080px; margin:2rem auto; padding:1rem 1.5rem; color:#64748b; font-size:.8rem; border-top:1px solid #e2e8f0; }
</style></head><body>
<header class="top"><div class="wrap">
  <h1>◆ Cartridge Exchange</h1><span class="tag">browse · verify · trade specialized agents</span>
  <a href="/">Roster</a> <a href="/publish">Publish</a>
</div></header>
<main>${body}</main>
<footer>An open reference exchange for <a href="https://zensical.org">Agent Cartridges</a> (<code>.acx</code>).
The exchange only reads metadata and <strong>verifies signatures</strong> — it never executes a cartridge.
Uploads are untrusted and shown with their trust status; tampered cartridges are rejected.</footer>
</body></html>`
}

function trustChip(s) {
  return `<span class="trust" style="background:${TRUST_COLOR[s.trust] || '#64748b'}" title="${esc(s.trustSummary)}">${esc(s.trust)}</span>`
}

function levelBadge(level) {
  if (!level || level.acxLevel == null) return `<span class="muted">no proven level</span>`
  return `<div class="badge">${esc(level.acxLevel)}<small>${esc(String(level.careerTier).toUpperCase())}</small></div>`
}

export function galleryPage(items) {
  const cards = items.map((c) => `
  <div class="cart">
    <div class="row" style="justify-content:space-between">
      <div><h3><a href="/c/${esc(c.id)}">${esc(c.name)}</a></h3>
      <div class="muted">${esc(c.role)} · ${esc(c.publisher)}</div></div>
      ${levelBadge(c.level)}
    </div>
    <div class="row">${trustChip(c)}
      ${c.capabilities.slice(0, 3).map((k) => `<span class="chip">${esc(k.taskType)}${k.verified ? ' ✓' : ''}</span>`).join('')}
    </div>
    <div class="row"><span class="rom">◆ ROM signed</span> <span class="save">▢ SAVE ${c.memory.save || 0}</span>
      <a class="btn ghost" href="/c/${esc(c.id)}" style="margin-left:auto">View</a></div>
  </div>`).join('')
  const verified = items.filter((c) => c.level).length
  return layout('Roster', `
  <p class="muted">${items.length} cartridges · ${verified} with a proven level · ranked by proven level & trust.</p>
  <div class="grid">${cards || '<p>No cartridges yet. <a href="/publish">Publish one</a>.</p>'}</div>`)
}

export function detailPage(c) {
  const caps = c.capabilities.map((k) => `<tr><td><code>${esc(k.taskType)}</code></td><td>${(k.stack || []).map(esc).join(', ') || '—'}</td><td>${esc(k.domain)}</td><td>${k.verified ? '<span class="verified">verified ✓</span>' : '<span class="unproven">self-declared</span>'}</td></tr>`).join('')
  const skills = c.skills.map((s) => `<tr><td><code>${esc(s.name)}</code></td><td>${esc(s.description)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">none</td></tr>'
  const level = c.level ? `
    <table>
      <tr><th>Career tier</th><td><strong>${esc(c.level.careerTier)}</strong> (Lv.${esc(c.level.acxLevel)})</td></tr>
      <tr><th>TrueSkill</th><td>μ=${esc(c.level.mu)} σ=${esc(c.level.sigma)} over ${esc(c.level.games)} held-out games</td></tr>
      <tr><th>Benchmark</th><td><code>${esc(c.level.benchmark)}</code></td></tr>
      <tr><th>Bound to ROM</th><td>${c.level.boundToRom ? '<span class="verified">yes ✓ (level cannot be transplanted)</span>' : '<span style="color:#b91c1c">NO — binding mismatch</span>'}</td></tr>
    </table>` : `<p class="muted">This cartridge carries no independently-verified level. Its <code>declaredLevel</code> is ${esc(c.declaredLevel)} (self-asserted).</p>`
  return layout(c.name, `
  <div class="row" style="justify-content:space-between; align-items:flex-start">
    <div><h2 style="margin:.2rem 0">${esc(c.name)}</h2>
      <div class="muted">${esc(c.role)} · ${esc(c.publisher)} · ${esc(c.provider)}/${esc(c.model)}</div>
      <div class="row">${trustChip(c)} <span class="muted">${esc(c.trustSummary)}</span></div>
    </div>${levelBadge(c.level)}
  </div>
  <div class="row">
    <a class="btn" href="/download/${esc(c.id)}">⇩ Acquire (.acx, ${(c.bytes / 1024).toFixed(0)} KB)</a>
    <a class="btn ghost" href="/verify/${esc(c.id)}">Re-verify</a>
  </div>
  <h3>Provable level</h3>${level}
  <h3>Capabilities</h3>
  <table><tr><th>Task type</th><th>Stack</th><th>Domain</th><th>Proof</th></tr>${caps}</table>
  <h3>Skills</h3>
  <table><tr><th>Name</th><th>Description</th></tr>${skills}</table>
  <h3>Integrity</h3>
  <table>
    <tr><th>ROM manifest hash</th><td><code>${esc(c.romHash)}</code></td></tr>
    <tr><th>Memory</th><td>ROM ${c.memory.rom || 0} · SAVE ${c.memory.save || 0}</td></tr>
  </table>
  <p><a href="/">← back to the roster</a></p>`)
}

export function publishPage(msg) {
  return layout('Publish', `
  <h2>Publish a cartridge</h2>
  ${msg ? `<p class="row"><span class="chip">${esc(msg)}</span></p>` : ''}
  <p>The exchange verifies every upload. A cartridge whose ROM signature fails or whose content was
  tampered is <strong>rejected</strong>; a valid one is added to the roster with its trust status.</p>
  <p>Publish by POSTing the raw <code>.acx</code> file (zero-dependency, no form needed):</p>
  <pre>curl -X POST --data-binary @my-agent.acx \\
     -H "Content-Type: application/vnd.acx.cartridge" \\
     -H "X-Cartridge-Id: my-agent" \\
     http://localhost:8787/publish</pre>
  <p>Make one first with the reference CLI:</p>
  <pre>node --experimental-sqlite src/cli.mjs export examples/sample-agent-package my-agent.acx \\
     --publisher io.github.you</pre>
  <p><a href="/">← back to the roster</a></p>`)
}
