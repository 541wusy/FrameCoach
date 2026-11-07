import { validateRecipe, claimsRefSettings, confidenceFor, idsToNames, plainGap, computeGaps,
  naiveLocal, timeline, timelineForModel, plainTrend, trendConfidence, evenSample, validateProgress } from './lib.js';

// Open http://localhost:8000/tests.html while server.py is running. The page title becomes "ALL PASS" or "FAIL".
const out = document.getElementById('out');
let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : fail++; out.textContent += `${cond ? 'PASS' : 'FAIL'}  ${name}\n`; };

const ids = ['bf2f7d7c', '6fc8e851', '061422ed', '7ec3712b'];
const gaps = { meanSaturation: { key: 'meanSaturation' }, meanLuminance: { key: 'meanLuminance' } };
const gear = { focalLength35mm: { min: 24, max: 300 }, aperture: { min: 1.8, max: 6.3 } };
const mk = (items) => ({ weakness: { text: 'x', photoIds: ['bf2f7d7c'] }, items });
const item = (o) => ({ action: 'Do a thing.', why: 'Because.', basis: { gapKey: 'meanSaturation' }, userPhotoIds: ['bf2f7d7c'], label: 'Measured', ...o });
const errsOf = (it) => validateRecipe(mk([it]), gaps, ids, gear);

// ---- Regression: the two warnings from the real run on 2026-11-04 (recipe-v2 prompt) ----
// Item 2 recommends a setting for the USER's shot. "overcast" and "references" share a sentence, but nothing is claimed about the references' settings.
t('run2 item 2 ("overcast ... as punchy as the references") is NOT a reference-settings claim', !claimsRefSettings({
  basis: { gapKey: 'meanSaturation' },
  action: 'For hazy coastal and overcast scenes such as bf2f7d7c, take the shot at -0.3 EV and raise vibrance slightly until the teal sea and green hills look as punchy as the references. Your saturation is 0.08 below theirs.',
}));
// Item 5: the sentence about the references ends before the 24mm / f/5.6 advice, which is for the user's own gear.
t('run2 item 5 (references in one sentence, 24mm and f/5.6 in the next) is NOT a reference-settings claim', !claimsRefSettings({
  basis: { referenceFeature: 'IMG_5071 and IMG_5282: foliage framing the top and sides of an elevated sea view' },
  action: "When shooting from a high viewpoint, step sideways until dark foliage covers the top and one side of the frame, as in the references' beach and cliff views. The leaves then frame the sea and road. Use a wide setting such as 24mm equivalent, around f/5.6.",
}));
// Genuine violations must still be caught.
t('"references were shot at golden hour" IS a reference-settings claim', claimsRefSettings({ basis: {}, action: 'The references were shot at golden hour, so go out then.' }));
t('"reference photos were taken at f/8" IS a reference-settings claim', claimsRefSettings({ basis: {}, action: 'The reference photos were taken at f/8 for deep focus.' }));
t('referenceFeature with "backlit" IS a reference-settings claim', claimsRefSettings({ basis: { referenceFeature: 'backlit foliage' }, action: 'Look for leaves.' }));
t('genuine claim labeled Measured -> validator error', errsOf(item({ action: 'The references were shot at golden hour, so go out then.', label: 'Measured' })).some((e) => /must be labeled Inferred/.test(e)));
t('genuine claim labeled Inferred -> no such error', !errsOf(item({ action: 'The references were shot at golden hour (a guess), so go out then.', label: 'Inferred' })).some((e) => /must be labeled Inferred/.test(e)));
t('a clean plain-language item passes the full validator', errsOf(item({ action: 'For hazy coastal scenes such as bf2f7d7c, shoot a little darker until the sea looks as rich as the references.' })).length === 0);

// ---- Numbers belong in startingPoint ----
t('"-0.7 EV" in action is rejected', errsOf(item({ action: 'Set exposure compensation to about -0.7 EV.' })).some((e) => /startingPoint/.test(e)));
t('"-0.7 EV" in startingPoint is accepted', errsOf(item({ startingPoint: 'exposure compensation around -0.7 EV' })).length === 0);
t('"1/15 of the frame" in action is rejected', errsOf(item({ action: 'Keep the person about 1/15 of the frame height.' })).some((e) => /startingPoint/.test(e)));
t('percentage in why is rejected', errsOf(item({ why: '47% of your photos are wide.' })).some((e) => /startingPoint/.test(e)));
t('missing "why" is rejected', errsOf(item({ why: undefined })).some((e) => /why/.test(e)));

// ---- Gear and ids ----
t('600mm outside gear range (24-300mm) without needsNewGear is rejected', errsOf(item({ action: 'Use a 600mm lens.' })).some((e) => /600mm/.test(e)));
t('600mm with needsNewGear is accepted', errsOf(item({ action: 'Use a 600mm lens.', needsNewGear: true })).length === 0);
t('f/1.2 in startingPoint outside aperture range is rejected', errsOf(item({ startingPoint: 'try f/1.2' })).some((e) => /f\/1.2/.test(e)));
t('unknown photo id is rejected', errsOf(item({ userPhotoIds: ['deadbeef'] })).some((e) => /unknown photo id/.test(e)));
t('missing weakness is rejected', validateRecipe({ items: [item({})] }, gaps, ids, gear).some((e) => /weakness/.test(e)));
t('nonexistent gapKey is rejected', errsOf(item({ basis: { gapKey: 'nope' } })).some((e) => /does not exist/.test(e)));
t('more than 7 items is rejected', validateRecipe(mk(Array(8).fill(item({}))), gaps, ids, gear).some((e) => /more than 7/.test(e)));

// ---- Confidence is decided by sample size ----
t('Inferred is always low', confidenceFor('Inferred', 100, 100) === 'low');
t('Measured, 15 photos / 10 refs -> medium', confidenceFor('Measured', 15, 10) === 'medium');
t('Measured, 25 photos / 10 refs -> high', confidenceFor('Measured', 25, 10) === 'high');
t('Measured, 6 photos / 3 refs -> low', confidenceFor('Measured', 6, 3) === 'low');
t('Observed, 15 photos / 10 refs -> medium (never high)', confidenceFor('Observed', 15, 10) === 'medium');
t('Observed with only 3 references -> low', confidenceFor('Observed', 15, 3) === 'low');

// ---- Stable ids -> file names ----
t('id in prose is replaced by file name', idsToNames('See 7ec3712b and bf2f7d7c.', { '7ec3712b': 'RXM02820.JPG', bf2f7d7c: 'IMG_7386.JPG' }) === 'See RXM02820.JPG and IMG_7386.JPG.');
t('unknown 8-hex word is left alone', idsToNames('deadbeef stays', {}) === 'deadbeef stays');

// ---- Gaps in plain words, no people-share gap ----
const mkp = (lum, sat, orient) => ({ status: 'done', analysis: { styleTags: [], people: { present: true } }, colorStats: { meanLuminance: lum, meanSaturation: sat, dominantColors: [] }, orientation: orient });
const g = computeGaps([mkp(0.5, 0.3, 'horizontal')], [mkp(0.3, 0.5, 'vertical')]);
t('no peopleShare gap is produced', !('peopleShare' in g));
t('plain gap text contains no digits', Object.values(g).every((x) => !/\d/.test(plainGap(x))));
t('"brighter than reference" gap says "lighter"', /lighter/.test(plainGap(g.meanLuminance)));

// ---- Change over time ----
const day0 = Date.UTC(2023, 0, 1);
const dateAt = (i, step = 36) => new Date(day0 + i * step * 864e5).toISOString().slice(0, 10) + 'T10:00:00';
const mkPhoto = (i, o = {}) => ({ id: 'p' + String(i).padStart(7, '0'), filename: `P${i}.JPG`, status: 'done', takenAt: dateAt(i, o.step), orientation: o.orient || 'horizontal',
  colorStats: { meanLuminance: o.lum ?? 0.5, meanSaturation: o.sat ?? 0.4, dominantColors: [] }, exif: { Model: 'CamA', FocalLengthIn35mmFormat: o.focal ?? 35 },
  analysis: { styleTags: [], weaknesses: o.weak ? [o.weak] : [], people: { present: false } } });
const ref = { meanLuminance: 0.3, meanSaturation: 0.5, verticalShare: 0.9 };

t('naiveLocal keeps the wall-clock time (no time zone shift)', naiveLocal(new Date(2026, 9, 26, 6, 48, 17)) === '2026-10-26T06:48:17');
t('timeline: fewer than 12 dated photos -> not available', !timeline(Array.from({ length: 8 }, (_, i) => mkPhoto(i))).available);
t('timeline: photos spanning under 60 days -> not available', /days/.test(timeline(Array.from({ length: 20 }, (_, i) => mkPhoto(i, { step: 1 }))).reason || ''));
t('timeline: photos without a date are counted, not used', timeline([...Array.from({ length: 14 }, (_, i) => mkPhoto(i)), { ...mkPhoto(99), takenAt: undefined }]).undated === 1);

// 20 photos: earlier half darker is NOT the case here; early lum 0.6, late lum 0.4, reference 0.3 -> darker, closer
const gradual = Array.from({ length: 20 }, (_, i) => mkPhoto(i, { lum: i < 10 ? 0.6 : 0.4, orient: i < 10 ? (i < 2 ? 'vertical' : 'horizontal') : (i < 16 ? 'vertical' : 'horizontal'), weak: i < 10 ? (i < 6 ? 'subject is tiny and easy to overlook' : '') : '' }));
const tl = timeline(gradual, ref);
t('timeline: 20 photos -> 2 periods, Earlier and Recent', tl.available && tl.periods.length === 2 && tl.periods[0].name === 'Earlier' && tl.periods[1].name === 'Recent');
t('timeline: 35 photos -> 3 periods', timeline(Array.from({ length: 35 }, (_, i) => mkPhoto(i)), ref).periods.length === 3);
t('trend: photos got darker and the reference is darker -> direction down, closer', tl.trends['trend:meanLuminance'].direction === 'down' && tl.trends['trend:meanLuminance'].toward === 'closer');
t('trend: more tall frames and the reference is mostly tall -> up, closer', tl.trends['trend:verticalShare'].direction === 'up' && tl.trends['trend:verticalShare'].toward === 'closer');
t('trend: small change counts as steady', timeline(Array.from({ length: 20 }, (_, i) => mkPhoto(i, { lum: 0.5 + (i < 10 ? 0 : 0.02) })), ref).trends['trend:meanLuminance'].steady);
t('trend: moving away from the reference is reported as further', timeline(Array.from({ length: 20 }, (_, i) => mkPhoto(i, { lum: i < 10 ? 0.4 : 0.6 })), ref).trends['trend:meanLuminance'].toward === 'further');
t('trend: a recurring problem that disappears is "rarer"', tl.trends['weak:subject too small']?.direction === 'rarer');
t('trend: focal length shift from 35 to 70 is reported', timeline(Array.from({ length: 20 }, (_, i) => mkPhoto(i, { focal: i < 10 ? 35 : 70 })), ref).trends['trend:focal']?.direction === 'longer');
t('plain trend sentence has no digits', Object.values(tl.trends).every((x) => !/\d/.test(plainTrend(x, tl))));
t('time-of-day sentence reads naturally', /mostly around midday; recently it is mostly in the late afternoon or evening/.test(plainTrend({ key: 'trend:timeOfDay', from: 'midday', to: 'late afternoon or evening' }, tl)));
t('plain trend sentence says "darker" and "closer to the references"', /darker/.test(plainTrend(tl.trends['trend:meanLuminance'], tl)) && /closer to the references/.test(plainTrend(tl.trends['trend:meanLuminance'], tl)));
t('model view of an unavailable timeline is null', timelineForModel({ available: false }, []) === null);
t('model view has no raw numbers in the trend sentences', Object.values(timelineForModel(tl, gradual).trends).every((x) => !/\d/.test(x.plain)));
const big = Array.from({ length: 100 }, (_, i) => mkPhoto(i));
const smp = evenSample(big, 40);
t('evenSample: 100 photos -> 40, covers first and last in time', smp.length === 40 && smp[0].id === big[0].id && smp.at(-1).id === big[99].id);
t('evenSample: fewer than the limit is returned unchanged', evenSample(big.slice(0, 10), 40).length === 10);

// ---- Progress notes: validator ----
const trendsMap = { 'trend:meanLuminance': {}, 'weak:subject too small': {} };
const pids = ['p0000001', 'p0000002'];
const good = { summary: 'Your recent photos are darker than your earlier ones.', changes: [{ text: 'Your recent photos are darker, closer to the references. Keep doing that.', trendKey: 'trend:meanLuminance', direction: 'closer', examples: ['p0000001'] }] };
t('progress: a good note passes', validateProgress(good, trendsMap, pids).length === 0);
t('progress: null is allowed (no timeline)', validateProgress(null, trendsMap, pids).length === 0);
t('progress: unknown trendKey is rejected', validateProgress({ ...good, changes: [{ ...good.changes[0], trendKey: 'trend:nope' }] }, trendsMap, pids).some((e) => /does not exist/.test(e)));
t('progress: "you improved" is rejected', validateProgress({ ...good, summary: 'You have clearly improved as a photographer.' }, trendsMap, pids).some((e) => /skill|improvement/.test(e)));
t('progress: "your skill grew" is rejected', validateProgress({ ...good, changes: [{ ...good.changes[0], text: 'Your skill has grown.' }] }, trendsMap, pids).length > 0);
t('progress: percentages are rejected', validateProgress({ ...good, changes: [{ ...good.changes[0], text: '47% of your photos are tall now.' }] }, trendsMap, pids).length > 0);
t('progress: unknown example photo is rejected', validateProgress({ ...good, changes: [{ ...good.changes[0], examples: ['deadbeef'] }] }, trendsMap, pids).some((e) => /unknown photo id/.test(e)));
t('progress: a bad direction is rejected', validateProgress({ ...good, changes: [{ ...good.changes[0], direction: 'better' }] }, trendsMap, pids).some((e) => /direction/.test(e)));
t('recipe item with a valid basis.trendKey passes', validateRecipe(mk([item({ basis: { trendKey: 'trend:meanLuminance' } })]), gaps, ids, gear, trendsMap).length === 0);
t('recipe item with an unknown basis.trendKey is rejected', validateRecipe(mk([item({ basis: { trendKey: 'trend:nope' } })]), gaps, ids, gear, trendsMap).some((e) => /trendKey/.test(e)));
t('recipe with a bad progress block is rejected', validateRecipe({ ...mk([item({})]), progress: { ...good, summary: 'You improved.' } }, gaps, ids, gear, trendsMap).length > 0);

// ---- Confidence for change-over-time notes ----
t('trend confidence: Measured with 30+ photos per period -> high', trendConfidence('Measured', 30) === 'high');
t('trend confidence: Observed is never high', trendConfidence('Observed', 100) === 'medium');
t('trend confidence: 15 photos per period -> medium', trendConfidence('Measured', 15) === 'medium');
t('trend confidence: fewer than 15 per period -> low', trendConfidence('Measured', 10) === 'low');

out.textContent += `\n${pass} passed, ${fail} failed\n`;
document.title = fail ? 'FAIL' : 'ALL PASS';
