import * as db from './db.js';
import { computeStats, computeGaps, gearRange, orientationOf, validateAnalysis, validateRecipe, recipeToMarkdown, plainGap, confidenceFor, idsToNames, LABEL_TEXT } from './lib.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => crypto.randomUUID().slice(0, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXIF_FIELDS = ['Make', 'Model', 'LensModel', 'FocalLength', 'FocalLengthIn35mmFormat', 'FNumber', 'ExposureTime', 'ISO', 'DateTimeOriginal'];

let photos = [], refs = [], recipe = null;
const live = { skipped: 0, failed: 0 };

// ---------- navigation / notice ----------
document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('on', p.id === b.dataset.p));
  render();
}));
if (!localStorage.getItem('fc_notice')) $('#notice').style.display = 'block';
$('#ok').onclick = () => { localStorage.setItem('fc_notice', '1'); $('#notice').style.display = 'none'; };

// ---------- image pipeline ----------
async function sha256(file) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function prepare(file) {
  let exif = {};
  try { // read BEFORE resize. Note: exifr lite throws TypeError when given `pick`, so parse fully and select ourselves.
    const full = (await exifr.parse(file)) || {};
    for (const k of EXIF_FIELDS) if (full[k] != null) exif[k] = full[k];
  } catch (e) { console.warn('EXIF read failed for', file.name, e); }
  console.log('[exif]', file.name, (file.size / 1e6).toFixed(1) + ' MB', Object.keys(exif).length + ' fields');
  if (exif.DateTimeOriginal instanceof Date) exif.DateTimeOriginal = exif.DateTimeOriginal.toISOString();
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
  const b64 = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(blob); });
  const colorStats = measureColor(c);
  const orientation = orientationOf(bmp.width, bmp.height);
  bmp.close();
  return { exif, b64, colorStats, orientation };
}

function measureColor(src) {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, s, s);
  const d = ctx.getImageData(0, 0, s, s).data, buckets = {};
  let L = 0, S = 0;
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    L += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    S += mx ? (mx - mn) / mx : 0;
    const k = [r, g, b].map((v) => Math.min(3, v >> 6)).join(',');
    buckets[k] = (buckets[k] || 0) + 1;
  }
  const n = d.length / 4;
  const dominantColors = Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) =>
    '#' + k.split(',').map((v) => Math.round(+v * 85).toString(16).padStart(2, '0')).join(''));
  return { meanLuminance: +(L / n).toFixed(3), meanSaturation: +(S / n).toFixed(3), dominantColors };
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return j;
}

// network retries with backoff (not for 4xx caps); one validation retry with the error appended
async function analyze(b64) {
  let retryError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { analysis, version } = await post('/api/analyze', { imageBase64: b64, retryError });
      const err = validateAnalysis(analysis);
      if (!err) return { analysis, version };
      if (retryError) throw new Error('Invalid model output: ' + err);
      retryError = err;
    } catch (e) {
      if (e.status === 429 || e.status === 413 || attempt === 2) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}

// ---------- uploads ----------
async function handleFiles(files, kind) {
  files = [...files];
  const bad = files.filter((f) => f.type !== 'image/jpeg');
  if (bad.length) alert('Only JPEG is supported for now (RAW/HEIC not yet). Skipped: ' + bad.map((f) => f.name).join(', '));
  files = files.filter((f) => f.type === 'image/jpeg');
  if (kind === 'ref' && refs.length + files.length > 10) { alert('Use at most 10 reference photos.'); return; }
  live.skipped = 0; live.failed = 0;
  await pool(files, 3, (f) => (kind === 'user' ? processUser(f) : processRef(f)));
  render();
}

async function processUser(file) {
  const hash = await sha256(file);
  const old = photos.find((p) => p.contentHash === hash);
  if (old?.status === 'done') { live.skipped++; return; }
  if (old) { photos = photos.filter((p) => p !== old); await db.del('photos', old.id); } // re-selected failed file: redo
  const p = { id: hash.slice(0, 8), contentHash: hash, filename: file.name, batchId: 'b' + Date.now(), status: 'analyzing', createdAt: new Date().toISOString(), schemaVersion: 1 };
  photos.push(p); render();
  try {
    const pre = await prepare(file);
    Object.assign(p, { exif: pre.exif, takenAt: pre.exif.DateTimeOriginal, colorStats: pre.colorStats, orientation: pre.orientation });
    const { analysis, version } = await analyze(pre.b64);
    Object.assign(p, { analysis, analysisVersion: version, analyzedAt: new Date().toISOString(), status: 'done' });
  } catch (e) { p.status = 'failed'; p.error = e.message; live.failed++; }
  await db.put('photos', p); render();
}

async function processRef(file) {
  const r = { id: uid(), name: file.name, createdAt: new Date().toISOString(), status: 'analyzing' }; // no image stored
  refs.push(r); render();
  try {
    const pre = await prepare(file);
    const { analysis } = await analyze(pre.b64);
    Object.assign(r, { colorStats: pre.colorStats, orientation: pre.orientation, analysis, status: 'done' });
  } catch (e) { r.status = 'failed'; r.error = e.message; }
  await db.put('refs', r); render();
}

async function retryPhoto(id) {
  // Browsers cannot reopen files by themselves, so the user re-selects the same file; failed records are replaced.
  alert('Select the same file again in the drop zone to retry it (browsers cannot reopen files on their own).');
}

// ---------- recipe ----------
async function makeRecipe() {
  const mine = photos.filter((p) => p.status === 'done');
  const rf = refs.filter((r) => r.status === 'done');
  if (mine.length < 3) return alert('Add at least 3 analyzed photos of your own first (My photos).');
  if (rf.length < 3) return alert('Add at least 3 reference photos.');
  const gaps = computeGaps(mine, rf), gear = gearRange(mine), ids = mine.map((p) => p.id);
  const ctx = {
    gaps: Object.fromEntries(Object.entries(gaps).map(([k, g]) => [k, { key: k, plain: plainGap(g) }])), gear,
    references: rf.map((r) => ({ name: r.name, ...r.analysis, colorStats: r.colorStats })),
    userPhotos: mine.map((p) => ({ id: p.id, name: p.filename, tags: p.analysis.styleTags, lighting: p.analysis.lighting, composition: p.analysis.composition, weaknesses: p.analysis.weaknesses, orientation: p.orientation, people: p.analysis.people })),
  };
  $('#makeRecipe').disabled = true; $('#recipeStatus').textContent = 'Thinking…';
  try {
    let out = await post('/api/recipe', ctx), errs = validateRecipe(out.recipe, gaps, ids, gear);
    if (errs.length) { // reject and regenerate once, then flag
      $('#recipeStatus').textContent = 'Validator rejected the first draft, regenerating…';
      out = await post('/api/recipe', { ...ctx, retryError: errs.join('; ') });
      errs = validateRecipe(out.recipe, gaps, ids, gear);
    }
    const names = Object.fromEntries(mine.map((p) => [p.id, p.filename]));
    const fix = (t) => idsToNames(t, names);
    const r = out.recipe;
    r.summary = fix(r.summary); r.weakness.text = fix(r.weakness.text);
    r.items.forEach((it) => { // confidence comes from code (sample size), never from the model
      it.action = fix(it.action); it.why = fix(it.why); if (it.startingPoint) it.startingPoint = fix(it.startingPoint);
      it.confidence = confidenceFor(it.label, mine.length, rf.length);
    });
    recipe = { id: uid(), createdAt: new Date().toISOString(), referenceNames: rf.map((r) => r.name), photoNames: names, profileBasis: { photoCount: mine.length, referenceCount: rf.length }, gaps, promptVersion: out.version, flagged: errs, schemaVersion: 1, ...r };
    await db.put('recipes', recipe);
    $('#recipeStatus').textContent = errs.length ? 'Done, with validator warnings.' : 'Done.';
  } catch (e) { $('#recipeStatus').textContent = 'Failed: ' + e.message; }
  $('#makeRecipe').disabled = false; render();
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- render ----------
const sw = (cs) => (cs || []).map((c) => `<span class="sw" style="background:${esc(c)}"></span>`).join('');
const tags = (a) => (a?.styleTags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');

function render() {
  const cnt = (s) => photos.filter((p) => p.status === s).length;
  $('#photoSummary').innerHTML = `<span class="mut">${photos.length} photos · ${cnt('done')} done · ${cnt('analyzing')} analyzing · <span class="${cnt('failed') ? 'bad' : ''}">${cnt('failed')} failed</span> · ${live.skipped} already seen (last upload)</span>`;
  $('#photoList').innerHTML = photos.map((p) => `<div class="card"><b>${esc(p.id)}</b> <span class="mut">${esc(p.filename)}</span><br>
    <span class="mut">${esc([p.exif?.Model, p.exif?.FocalLengthIn35mmFormat && p.exif.FocalLengthIn35mmFormat + 'mm', p.exif?.FNumber && 'f/' + p.exif.FNumber, p.exif?.ISO && 'ISO ' + p.exif.ISO].filter(Boolean).join(' · ') || 'no EXIF')}</span><br>
    ${p.status === 'done' ? tags(p.analysis) + `<div class="mut">${esc(p.analysis.lighting)}</div>` + (p.analysis.weaknesses[0] ? `<div class="mut">⚠ ${esc(p.analysis.weaknesses[0])}</div>` : '') : `<span class="${p.status === 'failed' ? 'bad' : 'mut'}">${esc(p.status)} ${esc(p.error || '')}</span>`}
    ${p.status === 'failed' ? `<br><button class="btn sec" data-retry="${p.id}">Retry</button>` : ''}</div>`).join('');
  document.querySelectorAll('[data-retry]').forEach((b) => (b.onclick = () => retryPhoto(b.dataset.retry)));

  $('#refSummary').textContent = `${refs.length} reference photos (images not stored)`;
  $('#refList').innerHTML = refs.map((r) => `<div class="card"><b>${esc(r.name)}</b><br>${r.status === 'done' ? tags(r.analysis) + '<br>' + sw(r.colorStats.dominantColors) + `<div class="mut">${esc(r.analysis.lighting)}</div>` : `<span class="${r.status === 'failed' ? 'bad' : 'mut'}">${esc(r.status)} ${esc(r.error || '')}</span>`}</div>`).join('');

  renderRecipe(); renderProfile();
}

function renderRecipe() {
  if (!recipe) { $('#gapOut').innerHTML = ''; $('#recipeOut').innerHTML = ''; return; }
  const nm = recipe.photoNames || {}, files = (ids) => ids.map((id) => nm[id] || id).join(', ');
  const g = Object.values(recipe.gaps);
  $('#gapOut').innerHTML = `<details><summary class="mut">The data behind the advice (optional)</summary><table>${g.map((x) => `<tr><td>${esc(plainGap(x))}</td></tr>`).join('')}</table></details>`;
  $('#recipeOut').innerHTML = `<h3>The look you're after</h3><div class="card">${esc(recipe.summary)}</div>
    <h3>What holds your photos back</h3><div class="card">${esc(recipe.weakness.text)} <span class="mut">(${esc(files(recipe.weakness.photoIds))})</span></div>
    ${recipe.flagged.length ? `<div class="card bad">Validator warnings:<ul>${recipe.flagged.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    <h3>Try this on your next shoot</h3>
    ${recipe.items.map((it, i) => `<div class="card"><b>${i + 1}.</b> ${esc(it.action)}<br>
      <span class="mut">Why: ${esc(it.why || '')}</span>
      ${it.startingPoint ? `<br><span class="mut">Starting point (a rule of thumb, not measured; try it and adjust): ${esc(it.startingPoint)}</span>` : ''}<br>
      <span class="lbl ${esc(it.label)}">${esc(LABEL_TEXT[it.label] || it.label)}</span> <span class="mut">how sure: ${esc(it.confidence)} · your photos: ${esc(files(it.userPhotoIds))}${it.needsNewGear ? ' · needs gear you may not have' : ''}</span></div>`).join('')}
    <button class="btn" id="dlRecipe">Download recipe card (.md)</button>`;
  $('#dlRecipe').onclick = () => download('framecoach-recipe.md', recipeToMarkdown(recipe, recipe.referenceNames), 'text/markdown');
}

function renderProfile() {
  const s = computeStats(photos);
  const kv = (o) => Object.entries(o).map(([k, v]) => `${esc(k)} (${v})`).join(', ') || 'unknown';
  const rng = (r, p = '') => (r ? `${p}${r.min} – ${p}${r.max}` : 'unknown');
  const top = Object.entries(s.tagShare).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, v]) => `<span class="tag">${esc(t)} ${Math.round(v * 100)}%</span>`).join('');
  $('#profileOut').innerHTML = !s.photoCount ? '<p class="mut">No photos yet.</p>' : `<p class="mut"><span class="lbl Measured">Measured</span> computed in code from EXIF and pixels; tags are <span class="lbl Observed">Observed</span> by the model.</p>
    <table>
    <tr><td>Photos</td><td>${s.photoCount} (${s.analyzedCount} analyzed)</td></tr>
    <tr><td>Cameras</td><td>${kv(s.cameras)}</td></tr><tr><td>Lenses</td><td>${kv(s.lenses)}</td></tr>
    <tr><td>Focal length (35mm eq.)</td><td>${rng(s.focalLength35mm)}</td></tr>
    <tr><td>Aperture</td><td>${rng(s.aperture, 'f/')}</td></tr><tr><td>ISO</td><td>${rng(s.iso)}</td></tr>
    <tr><td>Orientation</td><td>${kv(s.orientation)}</td></tr>
    <tr><td>Brightness / colour richness (0 to 1)</td><td>${s.meanLuminance} / ${s.meanSaturation}</td></tr>
    <tr><td>Dominant colors</td><td>${sw(s.dominantColors)}</td></tr>
    <tr><td>Top style tags</td><td>${top}</td></tr></table>`;
}

// ---------- data page ----------
$('#exp').onclick = async () => download('framecoach-export.json', JSON.stringify(await db.exportAll(), null, 2), 'application/json');
$('#impBtn').onclick = () => $('#imp').click();
$('#imp').onchange = async (e) => {
  try { await db.importAll(JSON.parse(await e.target.files[0].text())); await load(); $('#dataMsg').textContent = 'Imported.'; }
  catch (err) { $('#dataMsg').textContent = 'Import failed: ' + err.message; }
  e.target.value = '';
};
$('#delAll').onclick = async () => {
  if (!confirm('Delete ALL photos, references and recipes from this browser? Export first if unsure.')) return;
  await db.deleteAll(); photos = []; refs = []; recipe = null; localStorage.clear(); $('#dataMsg').textContent = 'Everything deleted.'; render();
};
$('#clearRefs').onclick = async () => { await db.clear('refs'); refs = []; render(); };
$('#makeRecipe').onclick = makeRecipe;

document.querySelectorAll('.drop').forEach((z) => {
  const input = z.querySelector('input');
  z.onclick = () => input.click();
  input.onchange = () => { handleFiles(input.files, z.dataset.kind); input.value = ''; };
  z.ondragover = (e) => { e.preventDefault(); z.classList.add('over'); };
  z.ondragleave = () => z.classList.remove('over');
  z.ondrop = (e) => { e.preventDefault(); z.classList.remove('over'); handleFiles(e.dataTransfer.files, z.dataset.kind); };
});

async function load() {
  photos = await db.all('photos'); refs = await db.all('refs');
  recipe = (await db.all('recipes')).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
  photos.filter((p) => p.status === 'analyzing').forEach((p) => { p.status = 'failed'; p.error = 'interrupted; re-select the file'; });
  render();
}
navigator.storage?.persist?.();
load();
