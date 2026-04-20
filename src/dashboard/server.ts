/**
 * Chronicle Dashboard — local HTTP server for Axon coordination UI.
 *
 * Usage: chronicle-mcp --dashboard [--dash-port 4321]
 *
 * Serves a single-page dashboard at http://localhost:4321 with three views:
 *   Personal  — my current task, branch, merge requests, history
 *   Team      — all contributors, availability, blocked/free, pending merges
 *   Project   — milestone progress, work queue, GS tier distribution, summary
 *
 * API endpoints (consumed by the UI via fetch):
 *   GET /api/projects                         → distinct project IDs
 *   GET /api/status?project=X                 → full team + queue + summary
 *   GET /api/merges?project=X[&status=pending] → merge request list
 *   GET /api/contributor?id=X                 → single contributor + their work
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parse as parseUrl } from 'node:url';
import { getDatabase } from '../infrastructure/db/database.js';
import { CoordinationService } from '../services/coordination-service.js';

export function startDashboard(port = 4321): void {
  const db = getDatabase();
  const coord = new CoordinationService(db);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const { pathname, query } = parseUrl(req.url ?? '/', true);

    // ── API ──────────────────────────────────────────────────────────────────
    if (pathname?.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');

      try {
        if (pathname === '/api/projects') {
          const rows = db.prepare(
            `SELECT DISTINCT project FROM work_packages
             UNION SELECT DISTINCT project FROM contributors
             ORDER BY project`,
          ).all() as any[];
          json(res, rows.map(r => r.project));

        } else if (pathname === '/api/status') {
          const project = (query['project'] as string) ?? 'default';
          json(res, coord.getStatus(project));

        } else if (pathname === '/api/merges') {
          const project = (query['project'] as string) ?? 'default';
          const status = query['status'] as 'pending' | 'approved' | 'rejected' | undefined;
          json(res, coord.listMergeRequests(project, status));

        } else if (pathname === '/api/contributor') {
          const id = query['id'] as string;
          if (!id) { json(res, { error: 'id required' }, 400); return; }
          const rows = db.prepare(`SELECT * FROM contributors WHERE id = ?`).get(id) as any;
          if (!rows) { json(res, { error: 'not found' }, 404); return; }
          const active = db.prepare(
            `SELECT * FROM work_packages WHERE assigned_to = ? AND status = 'active'`,
          ).all(id) as any[];
          const history = db.prepare(
            `SELECT wp.* FROM work_packages wp
             JOIN assignments a ON a.work_package_id = wp.id
             WHERE a.contributor_id = ? AND wp.status = 'complete'
             ORDER BY wp.completed_at DESC LIMIT 20`,
          ).all(id) as any[];
          json(res, { contributor: rows, activeWork: active, history });

        } else {
          json(res, { error: 'unknown endpoint' }, 404);
        }
      } catch (err: any) {
        json(res, { error: err?.message ?? 'internal error' }, 500);
      }
      return;
    }

    // ── Dashboard HTML ───────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(dashboardHtml(port));
  });

  server.listen(port, () => {
    console.error(`Chronicle Dashboard running at http://localhost:${port}`);
  });
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status);
  res.end(JSON.stringify(data, null, 2));
}

// ─── Dashboard HTML ─────────────────────────────────────────────────────────

function dashboardHtml(port: number): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chronicle · Axon Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f1117; --surface: #1a1d27; --border: #2a2d3a;
    --text: #e2e4ed; --muted: #6b7280; --accent: #6366f1;
    --green: #22c55e; --yellow: #eab308; --red: #ef4444; --blue: #3b82f6;
    --orange: #f97316;
  }
  body { background: var(--bg); color: var(--text); font: 14px/1.5 'Inter', system-ui, sans-serif; }
  header { padding: 16px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 16px; font-weight: 600; color: var(--accent); }
  header .sub { color: var(--muted); font-size: 12px; }
  .tabs { display: flex; gap: 2px; padding: 12px 24px 0; border-bottom: 1px solid var(--border); }
  .tab { padding: 8px 16px; cursor: pointer; border-radius: 6px 6px 0 0; font-size: 13px; color: var(--muted); border: 1px solid transparent; border-bottom: none; }
  .tab.active { color: var(--text); background: var(--surface); border-color: var(--border); }
  .pane { display: none; padding: 20px 24px; }
  .pane.active { display: block; }
  .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; flex-wrap: wrap; }
  select, input { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 6px 10px; border-radius: 6px; font-size: 13px; }
  .btn { background: var(--accent); color: white; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .btn:hover { opacity: 0.85; }
  .grid { display: grid; gap: 12px; }
  .grid-2 { grid-template-columns: 1fr 1fr; }
  .grid-3 { grid-template-columns: repeat(3, 1fr); }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .card h3 { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 12px; }
  .stat { font-size: 28px; font-weight: 700; }
  .stat.green { color: var(--green); } .stat.yellow { color: var(--yellow); }
  .stat.red { color: var(--red); } .stat.blue { color: var(--blue); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .badge-available { background: #14532d; color: var(--green); }
  .badge-busy       { background: #713f12; color: var(--yellow); }
  .badge-offline    { background: #1f2937; color: var(--muted); }
  .badge-pending    { background: #1e3a5f; color: var(--blue); }
  .badge-approved   { background: #14532d; color: var(--green); }
  .badge-rejected   { background: #450a0a; color: var(--red); }
  .badge-active     { background: #1e3a5f; color: var(--blue); }
  .badge-blocked    { background: #450a0a; color: var(--red); }
  .badge-complete   { background: #14532d; color: var(--green); }
  .badge-specwright { background: #2d1b69; color: #a78bfa; }
  .badge-builder    { background: #1e3a5f; color: var(--blue); }
  .badge-merger     { background: #713f12; color: var(--yellow); }
  .badge-verifier   { background: #14532d; color: var(--green); }
  .badge-watcher    { background: #1f2937; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 6px 10px; color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--border); }
  td { padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .branch { font-family: monospace; font-size: 12px; color: var(--accent); background: #12142a; padding: 2px 6px; border-radius: 4px; }
  .rank { font-weight: 700; color: var(--accent); min-width: 28px; display: inline-block; text-align: right; }
  .tier { display: inline-flex; align-items: center; gap: 6px; }
  .tier-dots { display: flex; gap: 3px; }
  .tier-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); }
  .tier-dot.on { background: var(--accent); }
  .progress { background: var(--border); border-radius: 999px; height: 6px; overflow: hidden; }
  .progress-bar { height: 100%; background: var(--accent); border-radius: 999px; transition: width .3s; }
  .section-title { font-size: 13px; font-weight: 600; color: var(--muted); margin: 20px 0 10px; }
  .empty { color: var(--muted); font-size: 13px; padding: 20px 0; text-align: center; }
  .refresh { color: var(--muted); font-size: 11px; }
  .milestone-row td { background: rgba(99,102,241,0.05); font-weight: 600; }
  @media (max-width: 700px) { .grid-2, .grid-3 { grid-template-columns: 1fr; } }
</style>
</head>
<body>

<header>
  <h1>Chronicle · Axon</h1>
  <span class="sub">Team coordination dashboard</span>
  <span class="refresh" id="refresh-time">—</span>
</header>

<div class="tabs">
  <div class="tab active" onclick="showTab('team')">Team</div>
  <div class="tab" onclick="showTab('project')">Project</div>
  <div class="tab" onclick="showTab('personal')">Personal</div>
</div>

<!-- ── TEAM ───────────────────────────────────────────────────────────────── -->
<div class="pane active" id="pane-team">
  <div class="controls">
    <select id="team-project" onchange="loadTeam()"><option value="">— project —</option></select>
    <button class="btn" onclick="loadTeam()">Refresh</button>
  </div>
  <div id="team-summary" class="grid grid-3" style="margin-bottom:20px"></div>
  <div class="section-title">Contributors</div>
  <div class="card" style="margin-bottom:16px"><table id="contributors-table">
    <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Current work</th><th>Branch</th></tr></thead>
    <tbody id="contributors-body"><tr><td colspan="5" class="empty">Select a project</td></tr></tbody>
  </table></div>
  <div class="section-title">Pending merge requests</div>
  <div class="card"><table>
    <thead><tr><th>Branch</th><th>Package</th><th>ForgeCraft</th><th>Status</th></tr></thead>
    <tbody id="merges-body"><tr><td colspan="4" class="empty">—</td></tr></tbody>
  </table></div>
</div>

<!-- ── PROJECT ────────────────────────────────────────────────────────────── -->
<div class="pane" id="pane-project">
  <div class="controls">
    <select id="project-project" onchange="loadProject()"><option value="">— project —</option></select>
    <button class="btn" onclick="loadProject()">Refresh</button>
  </div>
  <div id="project-summary" class="grid grid-3" style="margin-bottom:20px"></div>
  <div class="section-title">Work queue — ranked by priority</div>
  <div class="card"><table>
    <thead><tr><th>Rank</th><th>Title</th><th>Role</th><th>Status</th><th>Assigned to</th><th>Tier</th></tr></thead>
    <tbody id="queue-body"><tr><td colspan="6" class="empty">Select a project</td></tr></tbody>
  </table></div>
</div>

<!-- ── PERSONAL ───────────────────────────────────────────────────────────── -->
<div class="pane" id="pane-personal">
  <div class="controls">
    <select id="personal-project" onchange="loadPersonalContributors()"><option value="">— project —</option></select>
    <select id="personal-contributor" onchange="loadPersonal()"><option value="">— contributor —</option></select>
    <button class="btn" onclick="loadPersonal()">Refresh</button>
  </div>
  <div id="personal-current" class="grid grid-2" style="margin-bottom:20px"></div>
  <div class="section-title">My merge requests</div>
  <div class="card" style="margin-bottom:16px"><table>
    <thead><tr><th>Branch</th><th>Package</th><th>ForgeCraft</th><th>Status</th><th>Reviewed by</th></tr></thead>
    <tbody id="personal-merges-body"><tr><td colspan="5" class="empty">—</td></tr></tbody>
  </table></div>
  <div class="section-title">Work history</div>
  <div class="card"><table>
    <thead><tr><th>Title</th><th>Role</th><th>Completed</th><th>Tier</th></tr></thead>
    <tbody id="personal-history-body"><tr><td colspan="4" class="empty">—</td></tr></tbody>
  </table></div>
</div>

<script>
const API = 'http://localhost:${port}';
let allProjects = [];
let teamCache = null;
let mrCache = [];

// ── Tabs ────────────────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t,i) => {
    const tabs = ['team','project','personal'];
    t.classList.toggle('active', tabs[i] === name);
  });
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
  document.getElementById('pane-' + name).classList.add('active');
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function badge(cls, text) {
  return '<span class="badge badge-' + cls + '">' + esc(text) + '</span>';
}
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function tierDots(t) {
  if (!t) return '—';
  const names = ['','Unstr.','Ground.','Spec.','Verified','Orch.'];
  let dots = '<span class="tier-dots">';
  for (let i=1;i<=5;i++) dots += '<span class="tier-dot' + (i<=t?' on':'') + '"></span>';
  dots += '</span>';
  return '<span class="tier">' + dots + ' ' + esc(names[t]||t) + '</span>';
}
function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(); } catch { return s; }
}
function progress(done, total) {
  const pct = total > 0 ? Math.round(done/total*100) : 0;
  return '<div class="progress"><div class="progress-bar" style="width:'+pct+'%"></div></div><span style="font-size:11px;color:var(--muted)">'+pct+'% ('+done+'/'+total+')</span>';
}
function statCard(label, value, color) {
  return '<div class="card"><h3>'+esc(label)+'</h3><div class="stat '+esc(color)+'">'+esc(value)+'</div></div>';
}

// ── Projects ─────────────────────────────────────────────────────────────────
async function loadProjects() {
  const data = await fetch(API+'/api/projects').then(r=>r.json()).catch(()=>[]);
  allProjects = data;
  ['team','project','personal'].forEach(prefix => {
    const sel = document.getElementById(prefix+'-project');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— project —</option>';
    data.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      if (p === cur) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

// ── Team view ────────────────────────────────────────────────────────────────
async function loadTeam() {
  const project = document.getElementById('team-project').value;
  if (!project) return;
  const [status, merges] = await Promise.all([
    fetch(API+'/api/status?project='+encodeURIComponent(project)).then(r=>r.json()).catch(()=>null),
    fetch(API+'/api/merges?project='+encodeURIComponent(project)+'&status=pending').then(r=>r.json()).catch(()=>[]),
  ]);
  if (!status) return;
  teamCache = status;
  mrCache = merges;

  // Summary cards
  const s = status.summary;
  document.getElementById('team-summary').innerHTML =
    statCard('Total', s.total, '') +
    statCard('Active', s.active, 'blue') +
    statCard('Pending', s.pending, 'yellow') +
    statCard('Blocked', s.blocked, 'red') +
    statCard('Complete', s.complete, 'green') +
    statCard('Merge queue', merges.length, merges.length > 0 ? 'yellow' : '');

  // Contributors table
  const tbody = document.getElementById('contributors-body');
  if (!status.contributors?.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No contributors registered</td></tr>';
  } else {
    tbody.innerHTML = status.contributors.map(c => {
      const work = c.currentWork;
      return '<tr>'
        + '<td><strong>'+esc(c.name)+'</strong>'+(c.email?'<br><span style="color:var(--muted);font-size:11px">'+esc(c.email)+'</span>':'')+'</td>'
        + '<td>'+badge(c.role, c.role)+'</td>'
        + '<td>'+badge(c.availability, c.availability)+'</td>'
        + '<td>'+(work ? esc(work.title)+' '+badge(work.status,work.status) : '<span style="color:var(--muted)">free</span>')+'</td>'
        + '<td>'+(work?.branchName ? '<span class="branch">'+esc(work.branchName)+'</span>' : '—')+'</td>'
        + '</tr>';
    }).join('');
  }

  // Pending merges
  const mb = document.getElementById('merges-body');
  if (!merges.length) {
    mb.innerHTML = '<tr><td colspan="4" class="empty">No pending merge requests</td></tr>';
  } else {
    mb.innerHTML = merges.map(mr => {
      const fc = mr.forgecraftScore != null ? mr.forgecraftScore+'/14 '+tierDots(mr.forgecraftTier) : '—';
      return '<tr>'
        + '<td><span class="branch">'+esc(mr.branchName)+'</span></td>'
        + '<td>'+esc(mr.workPackageId)+'</td>'
        + '<td>'+fc+(mr.forgecraftPass!=null?' '+badge(mr.forgecraftPass?'approved':'rejected',mr.forgecraftPass?'pass':'fail'):'')+'</td>'
        + '<td>'+badge(mr.status,mr.status)+'</td>'
        + '</tr>';
    }).join('');
  }

  markRefresh();
}

// ── Project view ──────────────────────────────────────────────────────────────
async function loadProject() {
  const project = document.getElementById('project-project').value;
  if (!project) return;
  const status = await fetch(API+'/api/status?project='+encodeURIComponent(project)).then(r=>r.json()).catch(()=>null);
  if (!status) return;

  // Summary
  const s = status.summary;
  const done = s.complete; const total = s.total;
  document.getElementById('project-summary').innerHTML =
    statCard('Progress', done+'/'+total, done===total&&total>0?'green':'blue') +
    statCard('Blocked', s.blocked, s.blocked>0?'red':'green') +
    statCard('Pending merges', (mrCache||[]).filter(m=>m.status==='pending').length, '');

  // Work queue
  const tbody = document.getElementById('queue-body');
  const queue = status.queue ?? [];
  if (!queue.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Queue is empty</td></tr>';
  } else {
    // Resolve contributor names
    const contribMap = {};
    (status.contributors||[]).forEach(c => { contribMap[c.id] = c.name; });

    tbody.innerHTML = queue.map((wp,i) => {
      const isMilestone = wp.isMilestone;
      const rowClass = isMilestone ? 'milestone-row' : '';
      return '<tr class="'+rowClass+'">'
        + '<td><span class="rank">'+esc(wp.priorityRank)+'</span></td>'
        + '<td>'+(isMilestone?'🏁 ':'')+'<strong>'+esc(wp.title)+'</strong>'
          +(wp.specSection?'<br><span style="color:var(--muted);font-size:11px">'+esc(wp.specSection)+'</span>':'')+'</td>'
        + '<td>'+badge(wp.roleRequired, wp.roleRequired)+'</td>'
        + '<td>'+badge(wp.status, wp.status)+'</td>'
        + '<td>'+(wp.assignedTo ? esc(contribMap[wp.assignedTo]||wp.assignedTo) : '—')+'</td>'
        + '<td>'+tierDots(wp.forgecraftTier)+'</td>'
        + '</tr>';
    }).join('');
  }

  markRefresh();
}

// ── Personal view ─────────────────────────────────────────────────────────────
async function loadPersonalContributors() {
  const project = document.getElementById('personal-project').value;
  if (!project) return;
  const status = await fetch(API+'/api/status?project='+encodeURIComponent(project)).then(r=>r.json()).catch(()=>null);
  const sel = document.getElementById('personal-contributor');
  sel.innerHTML = '<option value="">— contributor —</option>';
  (status?.contributors??[]).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name + ' ('+c.role+')';
    sel.appendChild(opt);
  });
}

async function loadPersonal() {
  const id = document.getElementById('personal-contributor').value;
  const project = document.getElementById('personal-project').value;
  if (!id || !project) return;

  const [data, allMerges] = await Promise.all([
    fetch(API+'/api/contributor?id='+encodeURIComponent(id)).then(r=>r.json()).catch(()=>null),
    fetch(API+'/api/merges?project='+encodeURIComponent(project)).then(r=>r.json()).catch(()=>[]),
  ]);
  if (!data) return;

  const c = data.contributor;
  const work = data.activeWork?.[0];

  // Current task card
  document.getElementById('personal-current').innerHTML =
    '<div class="card"><h3>My status</h3>'
    + '<p style="margin-bottom:8px">'+badge(c.availability,c.availability)+' '+badge(c.role,c.role)+'</p>'
    + '<p style="color:var(--muted);font-size:12px">'+c.bandwidthHoursPerWeek+' hrs/week</p>'
    + '</div>'
    + '<div class="card"><h3>Current task</h3>'
    + (work
      ? '<strong>'+esc(work.title)+'</strong><br>'
        +'<span class="branch" style="display:inline-block;margin-top:6px">'+esc(work.branchName||'no branch')+'</span><br>'
        +'<span style="color:var(--muted);font-size:11px;display:block;margin-top:6px">Assigned '+fmtDate(work.assignedAt)+'</span>'
      : '<span style="color:var(--muted)">No active task</span>')
    + '</div>';

  // My merge requests
  const myMerges = allMerges.filter(m => m.fromContributorId === id);
  const mb = document.getElementById('personal-merges-body');
  if (!myMerges.length) {
    mb.innerHTML = '<tr><td colspan="5" class="empty">No merge requests</td></tr>';
  } else {
    mb.innerHTML = myMerges.map(mr => {
      return '<tr>'
        + '<td><span class="branch">'+esc(mr.branchName)+'</span></td>'
        + '<td>'+esc(mr.workPackageId)+'</td>'
        + '<td>'+(mr.forgecraftScore!=null?mr.forgecraftScore+'/14 '+tierDots(mr.forgecraftTier):'—')+'</td>'
        + '<td>'+badge(mr.status,mr.status)+(mr.forgecraftPass!=null?' '+badge(mr.forgecraftPass?'approved':'rejected',mr.forgecraftPass?'pass':'fail'):'')+'</td>'
        + '<td>'+(mr.approvedBy||mr.rejectedBy||'—')+'</td>'
        + '</tr>';
    }).join('');
  }

  // Work history
  const hb = document.getElementById('personal-history-body');
  if (!data.history?.length) {
    hb.innerHTML = '<tr><td colspan="4" class="empty">No completed work</td></tr>';
  } else {
    hb.innerHTML = data.history.map(wp => {
      return '<tr>'
        + '<td>'+esc(wp.title)+'</td>'
        + '<td>'+badge(wp.role_required||wp.roleRequired,wp.role_required||wp.roleRequired)+'</td>'
        + '<td style="color:var(--muted);font-size:12px">'+fmtDate(wp.completed_at||wp.completedAt)+'</td>'
        + '<td>'+tierDots(wp.forgecraft_tier||wp.forgecraftTier)+'</td>'
        + '</tr>';
    }).join('');
  }

  markRefresh();
}

function markRefresh() {
  document.getElementById('refresh-time').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadProjects();
setInterval(async () => {
  await loadProjects();
  const tp = document.getElementById('team-project').value;
  if (tp) loadTeam();
  const pp = document.getElementById('project-project').value;
  if (pp) loadProject();
}, 30_000);
</script>
</body>
</html>`;
}
