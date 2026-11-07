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
  add('peopleShare', u.peopleShare, r.peopleShare, 0.2);
  const tags = new Set([...Object.keys(u.tagShare), ...Object.keys(r.tagShare)]);
  for (const t of tags) add(`tag:${t}`, u.tagShare[t] || 0, r.tagShare[t] || 0, 0.3);
  const missing = r.dominantColors.filter((c) => !u.dominantColors.includes(c));
  if (missing.length) gaps.dominantColors = { key: 'dominantColors', user: u.dominantColors, reference: r.dominantColors, delta: null };
  return gaps;
}

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

// Rejects recipes that break the spec's rules. Returns list of error strings (empty = ok).
export function validateRecipe(r, gaps, userPhotoIds, gear) {
  const errs = [];
  if (!r || !Array.isArray(r.items)) return ['items must be an array'];
  if (r.items.length === 0) errs.push('no items');
  if (r.items.length > 7) errs.push('more than 7 items');
  if (!r.weakness?.text || !r.weakness?.photoIds?.length) errs.push('missing specific weakness with photo ids');
  else if (r.weakness.photoIds.some((id) => !userPhotoIds.includes(id))) errs.push('weakness cites unknown photo id');
  r.items.forEach((it, i) => {
    const tag = `item ${i + 1}`;
    if (typeof it.action !== 'string' || !it.action) return errs.push(`${tag}: no action`);
    const b = it.basis || {};
    if (!b.gapKey && !b.referenceFeature) errs.push(`${tag}: no basis`);
    if (b.gapKey && !gaps[b.gapKey]) errs.push(`${tag}: gapKey "${b.gapKey}" does not exist`);
    if (!Array.isArray(it.userPhotoIds) || !it.userPhotoIds.length) errs.push(`${tag}: cites no user photo`);
    else if (it.userPhotoIds.some((id) => !userPhotoIds.includes(id))) errs.push(`${tag}: cites unknown photo id`);
    if (!ENUM(it.label, ['Measured', 'Observed', 'Inferred'])) errs.push(`${tag}: bad label`);
    const refClaim = SETTING_WORDS.test(`${it.action} ${b.referenceFeature || ''}`) && /refer/i.test(`${it.action} ${b.referenceFeature || ''}`);
    if (refClaim && it.label !== 'Inferred') errs.push(`${tag}: setting/light claim about references must be labeled Inferred`);
    if (!it.needsNewGear && gear) {
      for (const m of it.action.matchAll(/(\d+(?:\.\d+)?)\s?mm/gi)) {
        const range = gear.focalLength35mm || gear.focalLength;
        const v = parseFloat(m[1]);
        if (range && (v < range.min || v > range.max)) errs.push(`${tag}: ${v}mm outside user range ${range.min}-${range.max} but needsNewGear not set`);
      }
      for (const m of it.action.matchAll(/f\/(\d+(?:\.\d+)?)/gi)) {
        const v = parseFloat(m[1]);
        if (gear.aperture && (v < gear.aperture.min || v > gear.aperture.max)) errs.push(`${tag}: f/${v} outside user range f/${gear.aperture.min}-${gear.aperture.max} but needsNewGear not set`);
      }
    }
  });
  return errs;
}

export function recipeToMarkdown(recipe, refNames) {
  const L = [`# FrameCoach shooting recipe`, '', `Created: ${recipe.createdAt}`, `Built from ${recipe.profileBasis.photoCount} of your photos.`,
    `References: ${refNames.join(', ') || 'n/a'}`, '', `## Style gap`, recipe.summary, '', `## Weakness`,
    `${recipe.weakness.text} (photos: ${recipe.weakness.photoIds.join(', ')})`, '', `## Checklist`];
  recipe.items.forEach((it, i) => {
    const basis = it.basis.gapKey ? `gap \`${it.basis.gapKey}\`` : `reference: ${it.basis.referenceFeature}`;
    L.push(`- [ ] **${i + 1}.** ${it.action}`, `  - ${it.label} · confidence ${it.confidence}${it.needsNewGear ? ' · needs new gear' : ''}`,
      `  - basis: ${basis} · your photos: ${it.userPhotoIds.join(', ')}`);
  });
  if (recipe.flagged?.length) L.push('', '## Validator warnings', ...recipe.flagged.map((e) => `- ${e}`));
  return L.join('\n');
}
