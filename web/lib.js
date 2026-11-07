// Pure functions: "code measures, the model judges". No DOM, no network.

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const count = (arr) => arr.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
const done = (photos) => photos.filter((p) => p.status === 'done' && p.analysis);

export function orientationOf(w, h) {
  if (!w || !h) return 'unknown';
  const r = w / h;
  return r > 1.05 ? 'horizontal' : r < 0.95 ? 'vertical' : 'square';
}

export function computeStats(photos) {
  const n = photos.length;
  const ok = done(photos);
  const ex = (f) => photos.map((p) => p.exif?.[f]).filter((v) => v != null);
  const range = (a) => (a.length ? { min: Math.min(...a), max: Math.max(...a) } : null);
  const orient = count(photos.map((p) => p.orientation || 'unknown'));
  const tags = count(ok.flatMap((p) => p.analysis.styleTags.map((t) => t.toLowerCase())));
  const colors = count(photos.flatMap((p) => p.colorStats?.dominantColors || []));
  const people = ok.filter((p) => p.analysis.people?.present).length;
  return {
    photoCount: n,
    analyzedCount: ok.length,
    cameras: count(photos.map((p) => [p.exif?.Make, p.exif?.Model].filter(Boolean).join(' ')).filter(Boolean)),
    lenses: count(ex('LensModel')),
    focalLength35mm: range(ex('FocalLengthIn35mmFormat')),
    focalLength: range(ex('FocalLength')),
    aperture: range(ex('FNumber')),
    iso: range(ex('ISO')),
    orientation: orient,
    verticalShare: n ? round((orient.vertical || 0) / n) : null,
    meanLuminance: round(avg(photos.map((p) => p.colorStats?.meanLuminance).filter((v) => v != null))),
    meanSaturation: round(avg(photos.map((p) => p.colorStats?.meanSaturation).filter((v) => v != null))),
    dominantColors: Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 5).map((e) => e[0]),
    peopleShare: ok.length ? round(people / ok.length) : null,
    tagShare: Object.fromEntries(Object.entries(tags).map(([t, c]) => [t, round(c / (ok.length || 1))])),
  };
}

export function gearRange(photos) {
  const s = computeStats(photos);
  return {
    cameras: Object.keys(s.cameras),
    lenses: Object.keys(s.lenses),
    focalLength35mm: s.focalLength35mm,
    focalLength: s.focalLength,
    aperture: s.aperture,
  };
}

// Gaps between reference set and the user's set. Each has a stable key the recipe must cite.
export function computeGaps(userPhotos, refPhotos) {
  const u = computeStats(userPhotos), r = computeStats(refPhotos);
  const gaps = {};
  const add = (key, user, ref, minDelta) => {
    if (user == null || ref == null) return;
    const delta = round(ref - user);
    if (Math.abs(delta) >= minDelta) gaps[key] = { key, user, reference: ref, delta };
  };
  add('meanLuminance', u.meanLuminance, r.meanLuminance, 0.05);
  add('meanSaturation', u.meanSaturation, r.meanSaturation, 0.05);
  add('verticalShare', u.verticalShare, r.verticalShare, 0.2);
  // peopleShare removed: "how many photos contain people" does not tell the user how to shoot.
  const tags = new Set([...Object.keys(u.tagShare), ...Object.keys(r.tagShare)]);
  for (const t of tags) add(`tag:${t}`, u.tagShare[t] || 0, r.tagShare[t] || 0, 0.3);
  const missing = r.dominantColors.filter((c) => !u.dominantColors.includes(c));
  if (missing.length) gaps.dominantColors = { key: 'dominantColors', user: u.dominantColors, reference: r.dominantColors, delta: null };
  return gaps;
}

// Plain-language version of a gap, so the model (and the user) never has to deal with raw numbers.
export function plainGap(g) {
  const k = g.key;
  if (k === 'meanLuminance') return g.reference < g.user ? 'Your photos are lighter and airier than the references, which look darker and moodier.' : 'Your photos are darker than the references, which look lighter and airier.';
  if (k === 'meanSaturation') return g.reference > g.user ? 'Colours in your photos are paler than in the references, which look richer.' : 'Colours in your photos are stronger than in the references, which look calmer.';
  if (k === 'verticalShare') return g.reference > g.user ? 'You mostly shoot wide (horizontal) frames; the references are mostly tall (vertical) frames.' : 'You shoot more tall frames than the references, which are mostly wide.';
  if (k === 'dominantColors') return "The colours that dominate your photos differ from the references' colours.";
  if (k.startsWith('tag:')) return g.reference > g.user ? `The references show more "${k.slice(4)}" than your photos.` : `Your photos show more "${k.slice(4)}" than the references.`;
  return k;
}

// Confidence is decided by code from sample size and kind of evidence, never by the model.
export function confidenceFor(label, nUser, nRef) {
  if (label === 'Inferred') return 'low';
  if (label === 'Observed') return nUser >= 5 && nRef >= 5 ? 'medium' : 'low';
  if (nUser >= 20 && nRef >= 8) return 'high';
  if (nUser >= 10 && nRef >= 5) return 'medium';
  return 'low';
}

// Confidence for a change-over-time note: depends on how many photos are in the smallest period.
// Notes that rest on the model's own observations (weak:*) can never be higher than medium.
export function trendConfidence(basis, minPeriodN) {
  if (minPeriodN >= 30 && basis === 'Measured') return 'high';
  return minPeriodN >= 15 ? 'medium' : 'low';
}

// Replace stable 8-char photo ids that leaked into prose with the real file names.
export function idsToNames(text, names) {
  return String(text ?? '').replace(/\b[0-9a-f]{8}\b/g, (id) => names[id] || id);
}

export const LABEL_TEXT = { Measured: 'From your photo data', Observed: 'Seen in the photos', Inferred: 'A guess' };

// ---------- Change over time (longitudinal). All of this is computed in code; the model only narrates it. ----------

// EXIF stores a wall-clock time without a time zone. exifr turns it into a Date in the browser's zone,
// so read it back with LOCAL getters to recover the original wall-clock time (toISOString would shift it).
export function naiveLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const hourBucket = (t) => { const h = parseInt(String(t).slice(11, 13), 10); if (Number.isNaN(h)) return null; return h >= 5 && h < 10 ? 'morning' : h >= 10 && h < 15 ? 'midday' : h >= 15 && h < 20 ? 'late afternoon or evening' : 'night'; };

// Recurring problems, found by keyword in the model's own per-photo notes. Rough on purpose; labeled Observed, never Measured.
const THEMES = {
  'subject too small': /\b(tiny|small|lost|overlook)/i,
  'empty or dull sky': /\bsky\b/i,
  'haze or flat light': /(haz|flat|wash|dull|muted)/i,
  'cluttered frame': /(clutter|busy|crowd|compet|cramp)/i,
  'cut off at the edge': /(cut off|cropped|clipped|partly)/i,
};
export function weaknessThemes(p) {
  const txt = (p.analysis?.weaknesses || []).join(' ; ');
  return Object.keys(THEMES).filter((k) => THEMES[k].test(txt));
}

const MIN_DATED = 12, MIN_SPAN_DAYS = 60;
const day = (t) => Date.parse(String(t).slice(0, 10));

// Splits dated photos into 2 (fewer than 30 photos) or 3 periods of equal size and compares first vs last.
// Returns { available:false, reason } when the data cannot support a fair comparison.
export function timeline(photos, refStats = null) {
  const dated = photos.filter((p) => p.takenAt && p.colorStats).sort((a, b) => (a.takenAt < b.takenAt ? -1 : 1));
  const undated = photos.length - dated.length;
  if (dated.length < MIN_DATED) return { available: false, undated, reason: `only ${dated.length} photos have a date (need ${MIN_DATED})` };
  const span = Math.round((day(dated.at(-1).takenAt) - day(dated[0].takenAt)) / 864e5);
  if (span < MIN_SPAN_DAYS) return { available: false, undated, reason: `your dated photos cover only ${span} days (need ${MIN_SPAN_DAYS}), too short to compare` };
  const k = dated.length >= 30 ? 3 : 2, names = k === 3 ? ['Earlier', 'Middle', 'Recent'] : ['Earlier', 'Recent'];
  const periods = names.map((name, i) => {
    const part = dated.slice(Math.floor((i * dated.length) / k), Math.floor(((i + 1) * dated.length) / k));
    const n = part.length, start = part[0].takenAt.slice(0, 10), end = part.at(-1).takenAt.slice(0, 10);
    const avgOf = (f) => { const v = part.map((p) => p.colorStats?.[f]).filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const hours = count(part.map((p) => hourBucket(p.takenAt)).filter(Boolean));
    const cams = count(part.map((p) => p.exif?.Model).filter(Boolean));
    const themeCount = {}; part.forEach((p) => weaknessThemes(p).forEach((t) => (themeCount[t] = (themeCount[t] || 0) + 1)));
    return {
      name, n, start, end, label: `${name} (${start.slice(0, 7)} to ${end.slice(0, 7)})`,
      lum: avgOf('meanLuminance'), sat: avgOf('meanSaturation'),
      vertical: part.filter((p) => p.orientation === 'vertical').length / n,
      focal: median(part.map((p) => p.exif?.FocalLengthIn35mmFormat).filter((v) => v != null)),
      topHour: Object.entries(hours).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      topCamera: Object.entries(cams).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      themes: Object.fromEntries(Object.entries(themeCount).map(([t, c]) => [t, c / n])),
    };
  });
  const first = periods[0], last = periods.at(-1), trends = {};
  for (const [key, f, thr] of [['meanLuminance', 'lum', 0.04], ['meanSaturation', 'sat', 0.04], ['verticalShare', 'vertical', 0.15]]) {
    const early = first[f], late = last[f], ref = refStats?.[key] ?? null;
    if (early == null || late == null) continue;
    const delta = late - early, steady = Math.abs(delta) < thr;
    trends[`trend:${key}`] = { key: `trend:${key}`, early, late, ref, steady, direction: steady ? 'steady' : delta > 0 ? 'up' : 'down',
      toward: steady || ref == null ? null : Math.abs(late - ref) < Math.abs(early - ref) ? 'closer' : 'further', basis: 'Measured' };
  }
  if (first.focal && last.focal && Math.abs(last.focal / first.focal - 1) >= 0.25) trends['trend:focal'] = { key: 'trend:focal', steady: false, direction: last.focal > first.focal ? 'longer' : 'wider', toward: null, basis: 'Measured' };
  if (first.topHour && last.topHour && first.topHour !== last.topHour) trends['trend:timeOfDay'] = { key: 'trend:timeOfDay', steady: false, direction: 'changed', from: first.topHour, to: last.topHour, toward: null, basis: 'Measured' };
  for (const t of Object.keys(THEMES)) {
    const er = first.themes[t] || 0, lr = last.themes[t] || 0;
    if (Math.max(er, lr) < 0.15) continue;
    const d = lr - er, steady = Math.abs(d) < 0.15;
    trends[`weak:${t}`] = { key: `weak:${t}`, theme: t, early: er, late: lr, steady, direction: steady ? 'steady' : d < 0 ? 'rarer' : 'more common', toward: null, basis: 'Observed' };
  }
  return { available: true, undated, spanDays: span, periods, trends, minPeriodN: Math.min(...periods.map((p) => p.n)) };
}

// Plain-language sentence for a trend. No numbers except the period names/dates.
export function plainTrend(t, tl) {
  const first = tl?.periods?.[0]?.name || 'Earlier', last = tl?.periods?.at(-1)?.name || 'Recent';
  const rel = t.toward === 'closer' ? ', which moves them closer to the references.' : t.toward === 'further' ? ', which moves them further from the references.' : '.';
  const k = t.key;
  if (k === 'trend:meanLuminance') return t.steady ? 'The overall brightness of your photos has stayed about the same.' : `Your ${last.toLowerCase()} photos are ${t.direction === 'up' ? 'lighter' : 'darker'} than your ${first.toLowerCase()} ones${rel}`;
  if (k === 'trend:meanSaturation') return t.steady ? 'The richness of colour in your photos has stayed about the same.' : `Colour in your ${last.toLowerCase()} photos is ${t.direction === 'up' ? 'richer' : 'paler'} than in your ${first.toLowerCase()} ones${rel}`;
  if (k === 'trend:verticalShare') return t.steady ? 'The mix of tall and wide frames has stayed about the same.' : `You shoot ${t.direction === 'up' ? 'more tall (vertical)' : 'more wide (horizontal)'} frames now than before${rel}`;
  if (k === 'trend:focal') return `You have moved toward ${t.direction} lenses or zoom settings over time.`;
  if (k === 'trend:timeOfDay') { const when = { morning: 'in the morning', midday: 'around midday', 'late afternoon or evening': 'in the late afternoon or evening', night: 'at night' }; return `You used to shoot mostly ${when[t.from] || t.from}; recently it is mostly ${when[t.to] || t.to}.`; }
  if (k.startsWith('weak:')) return t.steady ? `The problem "${t.theme}" still shows up about as often as before.` : `The problem "${t.theme}" shows up in ${t.direction === 'rarer' ? 'fewer' : 'more'} of your recent photos than your earlier ones.`;
  return k;
}

// What the model is allowed to see: period names and plain sentences, no raw numbers; plus a few example photos per period.
export function timelineForModel(tl, photos) {
  if (!tl?.available) return null;
  const examples = {};
  tl.periods.forEach((p) => {
    const part = photos.filter((x) => x.takenAt && x.takenAt.slice(0, 10) >= p.start && x.takenAt.slice(0, 10) <= p.end).sort((a, b) => (a.takenAt < b.takenAt ? -1 : 1));
    examples[p.label] = [0, Math.floor(part.length / 2), part.length - 1].filter((i, j, a) => a.indexOf(i) === j && part[i]).map((i) => ({ id: part[i].id, name: part[i].filename }));
  });
  return {
    periods: tl.periods.map((p) => ({ label: p.label, photoCount: p.n, mainCamera: p.topCamera })),
    trends: Object.fromEntries(Object.values(tl.trends).map((t) => [t.key, { key: t.key, plain: plainTrend(t, tl), kind: t.basis }])),
    examples, photosWithoutDate: tl.undated,
  };
}

// Even sample of photos in time order, so the model's context stays small for 100+ photos but still covers the whole period.
export function evenSample(items, max) {
  if (items.length <= max) return items;
  const sorted = [...items].sort((a, b) => ((a.takenAt || '') < (b.takenAt || '') ? -1 : 1));
  return Array.from({ length: max }, (_, i) => sorted[Math.floor((i * (sorted.length - 1)) / (max - 1))]);
}

// Code writes this caveat; the model is not trusted to remember it.
export const SKILL_NOTE = 'Photos alone cannot measure skill. This section only shows how your habits changed and whether the problems the AI notices have become more or less common.';

const ENUM = (v, list) => list.includes(v);
const strArr = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

// Returns an error string, or null if valid.
export function validateAnalysis(a) {
  if (!a || typeof a !== 'object') return 'not an object';
  if (!strArr(a.subjects)) return 'subjects must be string[]';
  if (!strArr(a.composition)) return 'composition must be string[]';
  if (typeof a.lighting !== 'string') return 'lighting must be string';
  if (typeof a.colorMood !== 'string') return 'colorMood must be string';
  if (!a.people || typeof a.people.present !== 'boolean') return 'people.present must be boolean';
  if (!ENUM(a.people.count, ['none', 'one', 'few', 'many'])) return 'people.count invalid';
  if (!ENUM(a.people.visibility, ['back', 'distant', 'face', 'n/a'])) return 'people.visibility invalid';
  if (!strArr(a.styleTags)) return 'styleTags must be string[]';
  if (!strArr(a.weaknesses)) return 'weaknesses must be string[]';
  if (!ENUM(a.confidence, ['low', 'medium', 'high'])) return 'confidence invalid';
  return null;
}

const SETTING_WORDS = /(f\/\d|\baperture\b|\bshutter\b|\biso\b|\d\s?mm\b|golden hour|sunset|sunrise|blue hour|time of day|backlit|overcast|midday|\bnoon\b|harsh light|soft light)/i;

// True if the item makes a claim about the REFERENCE photos' settings or light.
// Only a setting word that follows a reference mention in the same sentence counts; a recommendation
// for the user's own shot that merely mentions "the references" elsewhere is fine (see tests.js).
export function claimsRefSettings(it) {
  if (SETTING_WORDS.test(it.basis?.referenceFeature || '')) return true;
  return new RegExp(`refer[^.!?;]{0,80}?(?:${SETTING_WORDS.source})`, 'i').test(it.action || '');
}

// Exposure/size numbers must live in startingPoint (a labeled rule of thumb), not in the advice itself.
const LOOSE_NUMBER = /([-+]?\d+(?:\.\d+)?\s?EV\b|\d\s?%|\b1\/\d+\b)/i;

// Rejects recipes that break the spec's rules. Returns list of error strings (empty = ok).
// Skill judgements are not allowed: photos cannot measure skill (see SKILL_NOTE).
const SKILL_CLAIM = /\b(improv\w*|getting better|got better|got worse|better photographer|skill\w*|progress(?:ed)? as)\b/i;

export function validateProgress(p, trends, userPhotoIds) {
  const errs = [];
  if (p == null) return errs;
  if (typeof p.summary !== 'string' || !p.summary) errs.push('progress: no summary');
  if (!Array.isArray(p.changes) || !p.changes.length) errs.push('progress: no changes');
  else {
    if (p.changes.length > 6) errs.push('progress: more than 6 changes');
    p.changes.forEach((c, i) => {
      const tag = `progress ${i + 1}`;
      if (typeof c.text !== 'string' || !c.text) errs.push(`${tag}: no text`);
      if (!c.trendKey || !trends[c.trendKey]) errs.push(`${tag}: trendKey "${c.trendKey}" does not exist`);
      if (!ENUM(c.direction, ['closer', 'further', 'steady', 'different'])) errs.push(`${tag}: bad direction`);
      if (c.examples && (!Array.isArray(c.examples) || c.examples.some((id) => !userPhotoIds.includes(id)))) errs.push(`${tag}: cites unknown photo id`);
      if (LOOSE_NUMBER.test(c.text || '')) errs.push(`${tag}: no percentages, fractions or EV values`);
      if (SKILL_CLAIM.test(c.text || '')) errs.push(`${tag}: describe what changed, do not judge skill or improvement`);
    });
  }
  if (SKILL_CLAIM.test(p.summary || '')) errs.push('progress summary: describe what changed, do not judge skill or improvement');
  return errs;
}

export function validateRecipe(r, gaps, userPhotoIds, gear, trends = {}) {
  const errs = [];
  if (!r || !Array.isArray(r.items)) return ['items must be an array'];
  errs.push(...validateProgress(r.progress, trends, userPhotoIds));
  if (r.items.length === 0) errs.push('no items');
  if (r.items.length > 7) errs.push('more than 7 items');
  if (!r.weakness?.text || !r.weakness?.photoIds?.length) errs.push('missing specific weakness with photo ids');
  else if (r.weakness.photoIds.some((id) => !userPhotoIds.includes(id))) errs.push('weakness cites unknown photo id');
  r.items.forEach((it, i) => {
    const tag = `item ${i + 1}`;
    if (typeof it.action !== 'string' || !it.action) return errs.push(`${tag}: no action`);
    if (typeof it.why !== 'string' || !it.why) errs.push(`${tag}: no plain-language reason (why)`);
    const b = it.basis || {};
    if (!b.gapKey && !b.referenceFeature && !b.trendKey) errs.push(`${tag}: no basis`);
    if (b.gapKey && !gaps[b.gapKey]) errs.push(`${tag}: gapKey "${b.gapKey}" does not exist`);
    if (b.trendKey && !trends[b.trendKey]) errs.push(`${tag}: trendKey "${b.trendKey}" does not exist`);
    if (!Array.isArray(it.userPhotoIds) || !it.userPhotoIds.length) errs.push(`${tag}: cites no user photo`);
    else if (it.userPhotoIds.some((id) => !userPhotoIds.includes(id))) errs.push(`${tag}: cites unknown photo id`);
    if (!ENUM(it.label, ['Measured', 'Observed', 'Inferred'])) errs.push(`${tag}: bad label`);
    if (claimsRefSettings(it) && it.label !== 'Inferred') errs.push(`${tag}: setting/light claim about references must be labeled Inferred`);
    if (LOOSE_NUMBER.test(`${it.action} ${it.why}`)) errs.push(`${tag}: exposure numbers, percentages and fractions belong in startingPoint, not in action/why`);
    if (!it.needsNewGear && gear) {
      const text = `${it.action} ${it.startingPoint || ''}`;
      for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?mm/gi)) {
        const range = gear.focalLength35mm || gear.focalLength;
        const v = parseFloat(m[1]);
        if (range && (v < range.min || v > range.max)) errs.push(`${tag}: ${v}mm outside user range ${range.min}-${range.max} but needsNewGear not set`);
      }
      for (const m of text.matchAll(/f\/(\d+(?:\.\d+)?)/gi)) {
        const v = parseFloat(m[1]);
        if (gear.aperture && (v < gear.aperture.min || v > gear.aperture.max)) errs.push(`${tag}: f/${v} outside user range f/${gear.aperture.min}-${gear.aperture.max} but needsNewGear not set`);
      }
    }
  });
  return errs;
}

export function recipeToMarkdown(recipe, refNames) {
  const nm = recipe.photoNames || {};
  const files = (ids) => ids.map((id) => nm[id] || id).join(', ');
  const L = [`# FrameCoach shooting recipe`, '', `Created: ${recipe.createdAt}`,
    `Built from ${recipe.profileBasis.photoCount} of your photos and ${refNames.length} reference photos.`,
    `References: ${refNames.join(', ') || 'n/a'}`, `Prompt version: ${recipe.promptVersion || 'n/a'}`, '',
    `## The look you're after`, recipe.summary, '', `## What holds your photos back`,
    `${recipe.weakness.text} (photos: ${files(recipe.weakness.photoIds)})`, ''];
  if (recipe.progress) {
    L.push(`## How your photography has changed over time`, recipe.progress.summary, '');
    (recipe.progress.changes || []).forEach((c) => L.push(`- ${c.text}`, `  - Moving ${c.direction === 'closer' ? 'closer to' : c.direction === 'further' ? 'further from' : c.direction === 'steady' ? 'neither toward nor away from' : 'in a different direction from'} the references · based on: ${LABEL_TEXT[c.label] || c.label} · how sure: ${c.confidence}${c.examples?.length ? ` · e.g. ${files(c.examples)}` : ''}`));
    L.push('', `*${SKILL_NOTE}*`, '');
  } else if (recipe.timelineNote) L.push(`## How your photography has changed over time`, recipe.timelineNote, '');
  L.push(`## Try this on your next shoot`);
  recipe.items.forEach((it, i) => {
    const basis = it.basis.gapKey ? `difference found in your photo data (${it.basis.gapKey})` : it.basis.trendKey ? `change over time in your photos (${it.basis.trendKey})` : `reference photos: ${it.basis.referenceFeature}`;
    L.push(`- [ ] **${i + 1}.** ${it.action}`, `  - Why: ${it.why || ''}`);
    if (it.startingPoint) L.push(`  - Starting point (a rule of thumb, not measured; try it and adjust): ${it.startingPoint}`);
    L.push(`  - Based on: ${LABEL_TEXT[it.label] || it.label} · how sure: ${it.confidence}${it.needsNewGear ? ' · needs gear you may not have' : ''}`,
      `  - Your photos: ${files(it.userPhotoIds)} · evidence: ${basis}`);
  });
  if (recipe.flagged?.length) L.push('', '## Validator warnings', ...recipe.flagged.map((e) => `- ${e}`));
  L.push('', '---', `How sure is decided by code, not by the AI: "A guess" is always low; "Seen in the photos" is medium when you have at least 5 photos and 5 reference photos; "From your photo data" is medium from 10 photos and 5 references, high from 20 photos and 8 references.`);
  return L.join('\n');
}
