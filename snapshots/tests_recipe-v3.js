import { validateRecipe, claimsRefSettings, confidenceFor, idsToNames, plainGap, computeGaps } from './lib.js';

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

out.textContent += `\n${pass} passed, ${fail} failed\n`;
document.title = fail ? 'FAIL' : 'ALL PASS';
