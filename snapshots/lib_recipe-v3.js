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

// Replace stable 8-char photo ids that leaked into prose with the real file names.
export function idsToNames(text, names) {
  return String(text ?? '').replace(/\b[0-9a-f]{8}\b/g, (id) => names[id] || id);
}

export const LABEL_TEXT = { Measured: 'From your photo data', Observed: 'Seen in the photos', Inferred: 'A guess' };

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
    if (typeof it.why !== 'string' || !it.why) errs.push(`${tag}: no plain-language reason (why)`);
    const b = it.basis || {};
    if (!b.gapKey && !b.referenceFeature) errs.push(`${tag}: no basis`);
    if (b.gapKey && !gaps[b.gapKey]) errs.push(`${tag}: gapKey "${b.gapKey}" does not exist`);
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
    `${recipe.weakness.text} (photos: ${files(recipe.weakness.photoIds)})`, '', `## Try this on your next shoot`];
  recipe.items.forEach((it, i) => {
    const basis = it.basis.gapKey ? `difference found in your photo data (${it.basis.gapKey})` : `reference photos: ${it.basis.referenceFeature}`;
    L.push(`- [ ] **${i + 1}.** ${it.action}`, `  - Why: ${it.why || ''}`);
    if (it.startingPoint) L.push(`  - Starting point (a rule of thumb, not measured; try it and adjust): ${it.startingPoint}`);
    L.push(`  - Based on: ${LABEL_TEXT[it.label] || it.label} · how sure: ${it.confidence}${it.needsNewGear ? ' · needs gear you may not have' : ''}`,
      `  - Your photos: ${files(it.userPhotoIds)} · evidence: ${basis}`);
  });
  if (recipe.flagged?.length) L.push('', '## Validator warnings', ...recipe.flagged.map((e) => `- ${e}`));
  L.push('', '---', `How sure is decided by code, not by the AI: "A guess" is always low; "Seen in the photos" is medium when you have at least 5 photos and 5 reference photos; "From your photo data" is medium from 10 photos and 5 references, high from 20 photos and 8 references.`);
  return L.join('\n');
}
