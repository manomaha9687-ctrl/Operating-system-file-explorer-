'use strict';
const API = 'http://localhost:3000/api';
const $ = s => document.querySelector(s);
const state = { path: '', items: [], sel: new Set(), back: [], fwd: [], clip: null,
  sort: 'name', asc: true, view: 'details', hidden: false, trash: false, searching: false };

// ---------- helpers ----------
async function api(route, opts = {}) {
  const res = await fetch(API + route, { headers: { 'Content-Type': 'application/json' }, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const q = p => encodeURIComponent(p);
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }
const fmtSize = b => { if (b == null) return ''; const u = ['B','KB','MB','GB','TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + ' ' + u[i]; };
const fmtDate = d => new Date(d).toLocaleString();
const icon = i => i.isDir ? '📁' : ({ png:'🖼️', jpg:'🖼️', jpeg:'🖼️', gif:'🖼️', zip:'🗜️', txt:'📄', md:'📄', pdf:'📕' }[i.ext] || '📄');
const join = (a, b) => a.replace(/[\\/]$/, '') + '/' + b;
const parent = p => p.replace(/[\\/][^\\/]*$/, '') || '/';
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

// ---------- navigation ----------
async function navigate(path, push = true) {
  state.trash = false; state.searching = false; $('#search').value = '';
  const data = await api('/list?path=' + q(path) + '&hidden=' + state.hidden);
  if (push && state.path) { state.back.push(state.path); state.fwd = []; }
  state.path = data.path; state.items = data.items; state.sel.clear();
  render(); renderAddress(); $('#preview').innerHTML = '';
}
const nav = guard(navigate);
$('#back').onclick = guard(async () => { if (state.back.length) { state.fwd.push(state.path); await navigate(state.back.pop(), false); } });
$('#forward').onclick = guard(async () => { if (state.fwd.length) { state.back.push(state.path); await navigate(state.fwd.pop(), false); } });
$('#up').onclick = () => nav(parent(state.path));

function renderAddress() {
  const bar = $('#address'); bar.innerHTML = '';
  const parts = state.path.split(/[\\/]/).filter(Boolean); let acc = state.path.startsWith('/') ? '' : '';
  const root = document.createElement('button'); root.textContent = '/'; root.onclick = e => { e.stopPropagation(); nav('/'); }; bar.append(root);
  parts.forEach(p => { acc += '/' + p; const target = acc; const b = document.createElement('button');
    b.textContent = p; b.onclick = e => { e.stopPropagation(); nav(target); }; bar.append(b); });
}
$('#address').onclick = () => { const i = $('#addressInput'); i.value = state.path; $('#address').classList.add('hidden'); i.classList.remove('hidden'); i.focus(); i.select(); };
$('#addressInput').onkeydown = e => {
  if (e.key === 'Enter') { nav(e.target.value); e.target.blur(); }
  if (e.key === 'Escape') e.target.blur();
};
$('#addressInput').onblur = () => { $('#addressInput').classList.add('hidden'); $('#address').classList.remove('hidden'); };

// ---------- rendering ----------
function sorted() {
  const k = state.sort, d = state.asc ? 1 : -1;
  return [...state.items].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let x = a[k], y = b[k]; if (k === 'type') { x = a.ext; y = b.ext; }
    if (k === 'name' || k === 'type') return String(x).localeCompare(String(y), undefined, { numeric: true }) * d;
    return ((x > y) - (x < y)) * d;
  });
}
function render() {
  const c = $('#content'); c.className = state.view === 'details' ? '' : state.view; c.innerHTML = '';
  const items = sorted();
  if (!items.length) { c.innerHTML = `<div class="empty">${state.searching ? 'No matches. Try a different name or filter.' : state.trash ? 'Trash is empty.' : 'This folder is empty. Use New file or New folder to add something.'}</div>`; updateStatus(); return; }
  c.insertAdjacentHTML('beforeend', '<div class="row head"><span>Name</span><span>Size</span><span>Type</span><span>Date modified</span></div>');
  for (const it of items) {
    const r = document.createElement('div'); r.className = 'row' + (state.sel.has(it.path) ? ' sel' : ''); r.dataset.path = it.path;
    r.innerHTML = `<span class="n"><span class="ic">${icon(it)}</span> </span><span class="m">${it.isDir ? '' : fmtSize(it.size)}</span><span class="m">${it.isDir ? 'Folder' : (it.ext || 'File')}</span><span class="m">${fmtDate(it.modified)}</span>`;
    r.querySelector('.n').append(document.createTextNode(it.name)); // textContent-safe
    r.onclick = e => select(it, e);
    r.ondblclick = () => open(it);
    r.oncontextmenu = e => { e.preventDefault(); if (!state.sel.has(it.path)) select(it, {}); showMenu(e.clientX, e.clientY, itemMenu()); };
    r.draggable = true;
    r.ondragstart = e => e.dataTransfer.setData('text/plain', JSON.stringify([...state.sel.size ? state.sel : [it.path]]));
    if (it.isDir) { r.ondragover = e => e.preventDefault(); r.ondrop = guard(async e => { e.preventDefault(); const paths = JSON.parse(e.dataTransfer.getData('text/plain')); await api('/move', { method: 'POST', body: { sources: paths, destination: it.path } }); await navigate(state.path, false); toast('Moved'); }); }
    c.append(r);
  }
  updateStatus();
}
function updateStatus() {
  const sel = state.items.filter(i => state.sel.has(i.path));
  $('#status').textContent = `${state.items.length} items` + (sel.length ? ` · ${sel.length} selected · ${fmtSize(sel.reduce((s, i) => s + (i.size || 0), 0))}` : '');
}

// ---------- selection & open ----------
let lastIdx = -1;
function select(it, e) {
  const items = sorted(), idx = items.indexOf(it);
  if (e.shiftKey && lastIdx >= 0) { state.sel.clear(); items.slice(Math.min(lastIdx, idx), Math.max(lastIdx, idx) + 1).forEach(i => state.sel.add(i.path)); }
  else if (e.ctrlKey || e.metaKey) { state.sel.has(it.path) ? state.sel.delete(it.path) : state.sel.add(it.path); lastIdx = idx; }
  else { state.sel = new Set([it.path]); lastIdx = idx; }
  render(); if (state.sel.size === 1) showPreview(it); else $('#preview').innerHTML = '';
}
$('#content').onclick = e => { if (e.target.id === 'content') { state.sel.clear(); render(); $('#preview').innerHTML = ''; } };
const open = it => it.isDir ? nav(it.path) : window.open(API + '/download?path=' + q(it.path), '_blank');
async function showPreview(it) {
  const p = $('#preview'); p.innerHTML = '';
  if (it.isDir || state.trash) return;
  if (['png','jpg','jpeg','gif','webp','svg'].includes(it.ext)) { const i = new Image(); i.alt = it.name; i.src = API + '/download?path=' + q(it.path) + '&inline=1'; p.append(i); }
  else if (['txt','md','json','js','css','html','csv','log'].includes(it.ext)) { try { const r = await api('/preview?path=' + q(it.path)); const pre = document.createElement('pre'); pre.textContent = r.text; p.append(pre); } catch {} }
}

// ---------- operations ----------
const selected = () => [...state.sel];
const refresh = () => navigate(state.path, false);
async function ask(title, value = '') {
  return new Promise(res => {
    const d = $('#dialog'); d.innerHTML = `<form method="dialog"><h3>${title}</h3><input id="dlgIn" style="width:100%"><div class="btns"><button value="cancel">Cancel</button><button value="ok">OK</button></div></form>`;
    d.querySelector('#dlgIn').value = value; d.showModal(); d.querySelector('#dlgIn').select();
    d.onclose = () => res(d.returnValue === 'ok' ? d.querySelector('#dlgIn').value.trim() : null);
  });
}
const create = type => guard(async () => {
  const name = await ask(type === 'dir' ? 'New folder name' : 'New file name'); if (!name) return;
  await api('/create', { method: 'POST', body: { path: join(state.path, name), type } }); await refresh();
});
$('#newFolder').onclick = create('dir'); $('#newFile').onclick = create('file');
const doRename = guard(async () => {
  if (state.sel.size !== 1) return toast('Select one item to rename.');
  const [p] = selected(); const old = p.split('/').pop(); const name = await ask('Rename', old); if (!name || name === old) return;
  await api('/rename', { method: 'POST', body: { path: p, newName: name } }); await refresh();
});
$('#rename').onclick = doRename;
const setClip = mode => { if (!state.sel.size) return toast('Select items first.'); state.clip = { mode, items: selected() }; toast(`${mode === 'cut' ? 'Cut' : 'Copied'} ${state.clip.items.length} item(s)`); };
$('#copy').onclick = () => setClip('copy'); $('#cut').onclick = () => setClip('cut');
const doPaste = guard(async () => {
  if (!state.clip) return toast('Nothing to paste.');
  const r = await api(state.clip.mode === 'cut' ? '/move' : '/copy', { method: 'POST', body: { sources: state.clip.items, destination: state.path, onConflict: 'keepBoth' } });
  if (state.clip.mode === 'cut') state.clip = null; await refresh(); toast(`Done (${r.done} item(s))`);
});
$('#paste').onclick = doPaste;
const doDelete = guard(async (permanent = false) => {
  if (!state.sel.size) return toast('Select items first.');
  if (permanent && !confirm('Permanently delete the selected items? This cannot be undone.')) return;
  await api('/delete', { method: 'POST', body: { paths: selected(), permanent } }); state.sel.clear(); await refresh();
});
$('#delete').onclick = () => doDelete(false);
const showProps = guard(async () => {
  const [p] = selected(); const i = await api('/properties?path=' + q(p));
  const d = $('#dialog'); d.innerHTML = `<h3></h3><table>${[['Type', i.isDir ? 'Folder' : i.ext || 'File'], ['Location', i.location], ['Size', fmtSize(i.size) + (i.isDir ? ` (${i.count} items)` : '')], ['Created', fmtDate(i.created)], ['Modified', fmtDate(i.modified)], ['Permissions', i.mode]].map(([k, v]) => `<tr><td>${k}</td><td class="v"></td></tr>`).join('')}</table><div class="btns"><button onclick="this.closest('dialog').close()">Close</button></div>`;
  d.querySelector('h3').textContent = i.name; d.querySelectorAll('.v').forEach((c, n) => c.textContent = [i.isDir ? 'Folder' : i.ext || 'File', i.location, fmtSize(i.size) + (i.isDir ? ` (${i.count} items)` : ''), fmtDate(i.created), fmtDate(i.modified), i.mode][n]);
  d.showModal();
});

// ---------- trash ----------
async function showTrash() {
  const data = await api('/trash'); state.trash = true; state.path = 'Trash';
  state.items = data.items.map(t => ({ name: t.name, path: t.id, isDir: t.isDir, size: t.size, ext: '', modified: t.deletedDate, orig: t.originalPath }));
  state.sel.clear(); render(); $('#address').textContent = 'Trash';
}
$('#trashLink').onclick = e => { e.preventDefault(); guard(showTrash)(); };

// ---------- context menu ----------
function itemMenu() {
  if (state.trash) return [['Restore', guard(async () => { for (const id of selected()) await api('/trash/restore', { method: 'POST', body: { id } }); await showTrash(); })],
    ['Delete permanently', guard(async () => { if (confirm('Delete permanently?')) { for (const id of selected()) await api('/trash/' + q(id), { method: 'DELETE' }); await showTrash(); } }), 1]];
  return [['Open', () => open(state.items.find(i => i.path === selected()[0])) ], ['Cut', () => setClip('cut')], ['Copy', () => setClip('copy')], ['Rename', doRename],
    ['Delete', () => doDelete(false), 1], ['Properties', showProps]];
}
function showMenu(x, y, entries) {
  const m = $('#menu'); m.innerHTML = '';
  entries.forEach(([label, fn, danger]) => { const li = document.createElement('li'); li.textContent = label; li.role = 'menuitem'; if (danger) li.className = 'danger'; li.onclick = () => { hideMenu(); fn(); }; m.append(li); });
  m.style.left = Math.min(x, innerWidth - 190) + 'px'; m.style.top = Math.min(y, innerHeight - 40 * entries.length) + 'px'; m.classList.remove('hidden');
}
const hideMenu = () => $('#menu').classList.add('hidden');
document.addEventListener('click', hideMenu);
$('#content').addEventListener('contextmenu', e => { if (e.target.id === 'content' && !state.trash) { e.preventDefault(); showMenu(e.clientX, e.clientY, [['New folder', create('dir')], ['New file', create('file')], ['Paste', doPaste]]); } });

// ---------- search ----------
let searchTimer;
$('#search').oninput = e => { clearTimeout(searchTimer); const text = e.target.value.trim();
  searchTimer = setTimeout(guard(async () => {
    if (!text) return refresh(); state.searching = true;
    const r = await api('/search?path=' + q(state.path) + '&q=' + q(text) + '&hidden=' + state.hidden);
    state.items = r.items; state.sel.clear(); render();
  }), 300); };

// ---------- view, sort, theme, shortcuts ----------
$('#sort').onchange = e => { state.sort = e.target.value; render(); };
$('#sortDir').onclick = e => { state.asc = !state.asc; e.target.textContent = state.asc ? 'A–Z' : 'Z–A'; render(); };
$('#view').onchange = e => { state.view = e.target.value; render(); };
$('#hidden').onchange = e => { state.hidden = e.target.checked; refresh(); };
$('#theme').onclick = () => { const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; };
document.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT', 'DIALOG'].includes(document.activeElement.tagName)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'c') setClip('copy'); else if (mod && e.key === 'x') setClip('cut'); else if (mod && e.key === 'v') doPaste();
  else if (mod && e.key === 'a') { e.preventDefault(); state.items.forEach(i => state.sel.add(i.path)); render(); }
  else if (mod && e.key === 'f') { e.preventDefault(); $('#search').focus(); }
  else if (mod && e.key === 'l') { e.preventDefault(); $('#address').click(); }
  else if (e.key === 'F2') doRename();
  else if (e.key === 'Delete') doDelete(e.shiftKey);
  else if (e.altKey && e.key === 'ArrowLeft') $('#back').click();
  else if (e.altKey && e.key === 'ArrowRight') $('#forward').click();
  else if (e.altKey && e.key === 'Enter') showProps();
});

// ---------- init (favorites, drives) ----------
(async () => { try {
  const side = await api('/places');
  $('#favorites').innerHTML = ''; side.favorites.forEach(f => { const li = document.createElement('li'), a = document.createElement('a'); a.href = '#'; a.textContent = f.name; a.onclick = e => { e.preventDefault(); nav(f.path); }; li.append(a); $('#favorites').append(li); });
  $('#drives').innerHTML = ''; side.drives.forEach(d => { const li = document.createElement('li'), a = document.createElement('a'); a.href = '#'; a.className = 'drive'; a.onclick = e => { e.preventDefault(); nav(d.path); };
    const t = document.createElement('span'); t.textContent = d.name; const s = document.createElement('small'); s.textContent = `${fmtSize(d.free)} free of ${fmtSize(d.total)}`;
    const bar = document.createElement('div'); bar.className = 'bar'; bar.innerHTML = `<i style="width:${d.total ? 100 - d.free / d.total * 100 : 0}%"></i>`; a.append(t, s, bar); li.append(a); $('#drives').append(li); });
  await navigate(side.home, false);
} catch (e) { toast('Cannot reach server: ' + e.message); } })();
setInterval(() => { if (!state.trash && !state.searching && state.path) api('/list?path=' + q(state.path) + '&hidden=' + state.hidden).then(d => { if (JSON.stringify(d.items.map(i => [i.name, i.modified])) !== JSON.stringify(state.items.map(i => [i.name, i.modified]))) { state.items = d.items; render(); } }).catch(() => {}); }, 5000); // auto-refresh (FR-SHL-06)
