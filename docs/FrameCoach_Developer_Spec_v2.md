# FrameCoach: Developer Specification (Version 2)

This document is the build brief for Claude Code. Read it fully before writing code. When something here is ambiguous or conflicts with what you find in the repo, ask before choosing. Items under "Open questions" are not decided.

Version 2 matches Proposal v2. The main change: the **reference-based coaching feature is the top priority**, because existing products already cover photo critique, camera statistics and rating trends. Change tracking between batches is now lower priority and is the first feature to cut if time runs short.

## 1. What we are building

A web app for hobbyist photographers.

1. The user uploads their own photos, any number per batch.
2. The app reads camera data (EXIF) in the browser, removes photos it has already seen, shrinks the rest, and sends each to a vision model for a structured description.
3. The app keeps a lasting style profile, built from everything analyzed so far, stored in the user's own browser. There are no accounts in the first version.
4. **Main feature:** the user uploads a few reference photos whose style they admire. The app compares the reference style with their own and produces a **shooting recipe**: a short list of concrete, testable things to do differently on the next shoot to get closer to that look.
5. Lower priority: when the user uploads a new batch, only the new photos are analyzed, the profile is updated, and the app reports what changed.

What makes this different from existing tools: dedicated critique tools, camera statistics tools and general chat assistants already exist. Tools that use reference photos mostly edit the picture afterward. FrameCoach should teach the photographer how to *capture* a similar look. Scale and memory (more photos than fit in one chat, and a profile that persists) support this, but they are not the main claim. Everything below should serve the reference-based recipe first.

## 2. Principles that decide design questions

1. **Code measures, the model judges.** Anything that can be computed (camera settings, counts, averages, brightness, color) is computed in code, never by the model. The model describes images and writes interpretation.
2. **Never invent settings.** The model must not state a camera, lens, aperture, shutter speed, ISO or focal length. Those come from EXIF only. If missing, the value is unknown.
3. **Label every claim.** Each statement in a report carries one label: `Measured` (computed from files), `Observed` (visible in the image), or `Inferred` (a guess). The UI shows the label.
4. **Analyze once, store the result.** A photo is analyzed one time. Profiles are built from stored results, not by re-reading images.
5. **Privacy by default.** Original images never leave the device. By default we store results and EXIF only, not images.
6. **Specific or nothing.** Advice must cite the user's own photos by ID. Generic tips ("use the rule of thirds") are a bug.
7. **Always include a weakness.** Every report contains at least one specific, evidence-backed weakness. No pure praise.

## 3. Scope

**Priority 0 (carries the main claim; build first):**
- JPEG upload, any batch size, with progress and retry.
- EXIF reading, duplicate detection, thumbnails-optional storage.
- Per-photo analysis and style profile.
- Reference photo comparison and shooting recipe, with a downloadable recipe card.
- Export and import of all data as JSON, delete-all, rate limits and spending cap.

**Priority 1 (build if time allows; first to cut):**
- Snapshots and the change report between batches.

**Not in the MVP:** accounts, cloud library or folder connections, folder watching, RAW and HEIC, mobile apps, sharing, payments.

**Mid-term:** optional accounts and cross-device sync. The storage layer must make this a swap, not a rewrite (section 6).

## 4. Suggested stack

These are defaults. Propose an alternative if you have a good reason.

- **Frontend:** TypeScript, React, Vite (or Next.js if a serverless API route is easier to host together).
- **Local storage:** IndexedDB through Dexie.
- **EXIF in browser:** `exifr`.
- **Image resize and color stats:** Canvas API (an `OffscreenCanvas` in a Web Worker if available).
- **Hashing:** `crypto.subtle.digest('SHA-256', ...)` on the original file bytes.
- **Validation:** `zod` for every model response and every stored record.
- **Model access:** a thin serverless function (for example a Vercel or Cloudflare function) that forwards requests to the Anthropic API. Model names come from environment variables. Suggested defaults: a smaller, cheaper model for per-photo analysis and a stronger model for profile and report writing. Check https://docs.claude.com for current model names before choosing. Do not hardcode names in code.
- **Testing:** Vitest for pure functions. Playwright for one end-to-end flow.

## 5. Architecture

```
Browser
  Upload UI
    -> read EXIF (before any resize)
    -> hash original bytes (dedupe)
    -> resize to ~1600 px long edge, JPEG ~0.8
    -> compute color stats on the resized image
    -> queue (concurrency 3 to 4, retry with backoff)
         -> POST /api/analyze  { imageBase64, minimalContext }
              (serverless function adds the API key, calls the model)
         <- structured JSON, validated with zod
    -> save to IndexedDB
  Profile builder (pure functions)
    -> statistics from EXIF and color stats
    -> snapshot
    -> POST /api/synthesize { stats, per-photo tags and ids }  (no images)
    <- profile narrative and report
```

Key rules:
- **Read EXIF before resizing.** Canvas resizing strips EXIF. Read it from the original file first and keep it separate.
- **No API key in the browser, ever.** Add a test that the production bundle contains no key strings.
- **Synthesis calls send text only.** Per-photo tags and statistics, not images.

## 6. Data model

All records use UUIDs, `createdAt` and `updatedAt`, and a `schemaVersion`. Put all storage behind a repository interface (for example `PhotoRepo`, `SnapshotRepo`, `ReferenceRepo`, `SettingsRepo`) so an account-backed server database can replace IndexedDB later.

```ts
Photo {
  id: string                 // UUID
  contentHash: string        // SHA-256 of original bytes; unique, used for dedupe
  filename: string
  batchId: string
  takenAt?: string           // ISO, from EXIF
  exif: {
    make?, model?, lensModel?,
    focalLength?, focalLength35mm?,
    fNumber?, exposureTime?, iso?,
    width?, height?, orientation?
  }
  colorStats: { meanLuminance, meanSaturation, dominantColors: string[] }
  analysis?: PhotoAnalysis   // absent until analyzed
  analysisVersion?: string   // prompt and model version used
  analyzedAt?: string
  status: 'queued' | 'analyzing' | 'done' | 'failed'
  thumbnail?: Blob           // only if the user opted in
}

PhotoAnalysis {
  subjects: string[]
  composition: string[]          // e.g. leading lines, frame within frame
  lighting: string               // e.g. backlit, dusk, flat overcast
  colorMood: string
  people: { present: boolean, count: 'none'|'one'|'few'|'many', visibility: 'back'|'distant'|'face'|'n/a' }
  styleTags: string[]
  weaknesses: string[]           // specific and visible, may be empty
  confidence: 'low' | 'medium' | 'high'
}

Batch { id, uploadedAt, photoIds: string[] }

Snapshot {
  id, createdAt, photoCount, batchIds: string[]
  stats: ComputedStats           // see section 8
  narrative: ReportSection[]     // each item carries a label and photo ids
  previousSnapshotId?: string
}

Reference { id, setId, name, features: ColorStats & {orientation, ...}, description, createdAt }
// No reference image is stored.

ReferenceSet { id, name, referenceIds: string[], createdAt }

Recipe {
  id, referenceSetId, createdAt
  profileBasis: { photoCount: number, snapshotId?: string }   // what the recipe was built from
  items: RecipeItem[]            // at most 7
  promptVersion: string
}

RecipeItem {
  id: string
  action: string                 // one concrete thing to do on the next shoot
  basis: {
    gapKey?: string              // a measured gap computed in code, e.g. 'meanLuminance'
    referenceFeature?: string    // an observed feature of the references
  }
  userPhotoIds: string[]         // at least one of the user's photos this change applies to
  label: 'Measured' | 'Observed' | 'Inferred'
  confidence: 'low' | 'medium' | 'high'
  needsNewGear?: boolean         // true if the advice is outside the user's EXIF-observed gear range
}

Settings { storeThumbnails: boolean, consentedAt?: string, schemaVersion }
```

## 7. Upload and queue behavior

- Accept `image/jpeg` only in the MVP. For anything else, show a clear message that RAW and HEIC are not yet supported and suggest exporting JPEG.
- Hash first. If the hash already exists, skip the photo and count it as "already analyzed."
- Show per-batch progress: queued, analyzing, done, failed, skipped.
- Retries: up to 3 with exponential backoff. A failed photo stays visible with a retry button and never blocks the others.
- A batch can be paused and resumed. If the tab closes mid-batch, unfinished photos resume on next visit only if the user selects the same files again (browsers cannot reopen files by themselves). Explain this in the UI.
- Cap batch size per request and per day on the server side (section 11).

## 8. Statistics (computed in code)

From stored EXIF and color stats, compute and store in each snapshot:

- Camera and lens usage counts.
- Focal length distribution in 35 mm equivalent where available.
- Aperture, shutter speed and ISO distributions.
- Time-of-day distribution, from `takenAt`.
- Orientation split (vertical, horizontal, square).
- Mean luminance, mean saturation, and dominant color palette across the set.
- Share of photos containing people, and how they appear.
- Tag frequencies from `PhotoAnalysis`.

Unit-test every function. Treat missing EXIF as unknown, not zero.

## 9. Model prompts and outputs

Two prompts, both versioned and stored with the output (`analysisVersion`).

### 9.1 Per-photo analysis

Input: the resized image and a minimal context message. Output: JSON only, matching `PhotoAnalysis`.

Requirements to put in the system prompt:
- Describe only what is visible. Do not state or guess camera, lens or any settings.
- Do not identify any person or guess identity, age or other personal traits. Only describe presence and how the person appears (for example "walking away").
- List weaknesses only if they are visible at this resolution. Do not comment on focus accuracy or noise, which cannot be judged from a downsized image.
- Return `confidence`.
- If the image is unclear, say so instead of guessing.

Validate with zod. On a validation failure, retry once with the error message appended, then mark the photo as `failed`.

### 9.2 Profile and report synthesis

Input: the snapshot statistics, per-photo tags with photo IDs, and optionally the previous snapshot and reference features. No images.

The output is a list of sections, each with `label` (`Measured` | `Observed` | `Inferred`), `text`, and `photoIds`. Required content:
1. Style profile, in plain language.
2. At least one specific weakness, citing photo IDs.
3. Gear observations that follow from the EXIF statistics. Lens suggestions must fit the camera mount found in the EXIF and carry a note to verify current price and availability.
4. Shooting tips, each citing at least one photo ID.
5. Priority 1: if a previous snapshot exists, what changed, using the computed deltas. The model explains the numbers and must not invent new ones.

The shooting recipe is not produced here. It comes from the separate prompt in section 10.

Reject and regenerate any report where a tip has no photo ID, where a number does not match the computed statistics, or where it states a setting not present in the EXIF data. Write a validator for these checks.

## 10. Reference comparison and shooting recipe (main feature)

**Inputs and processing**
- The user uploads 3 to 10 reference photos. Compute the same color stats and run the per-photo analysis. Do not store the images.
- Reference photos usually have no EXIF. Any statement about their likely focal length, aperture, exposure or time of day is `Inferred` and says why.
- Compute gaps between the reference set and the user's set in code (luminance, saturation, orientation split, people share and visibility, dominant colors, tag frequencies). Each gap gets a stable key such as `meanLuminance`, so the recipe can point to it.

**Recipe generation (separate prompt, versioned)**
- Input: the computed gaps, the references' per-photo descriptions, the user's profile statistics and per-photo tags with photo IDs, and the user's gear range from EXIF (cameras, lenses, focal length range, aperture range). No images.
- Output: a `Recipe` (section 6) with at most 7 items. Each item is one concrete action for the next shoot. It names the condition (for example light or location) and the change (for example framing or exposure compensation), not a general tip.
- Every item must point to a measured gap or an observed reference feature (`basis`), and cite at least one of the user's photos it applies to.
- Advice about settings, light or time of day for the references is always labeled `Inferred`.
- Recommended focal lengths and apertures must fall within the range seen in the user's EXIF. If not, set `needsNewGear: true` and say so in the text.

**Recipe validator (reject and regenerate once, then flag in the UI)**
- An item has no `basis`, or `basis` points to a gap key that does not exist.
- An item cites no user photo ID, or cites an ID that is not in the database.
- A setting, time of day or lighting claim about a reference is not labeled `Inferred`.
- A recommended focal length or aperture is outside the user's range but `needsNewGear` is not set.
- More than 7 items.

**Recipe card**
- The user can download the recipe as a Markdown checklist, with item IDs and reference names (not reference images). This supports the recipe test in the evaluation plan, where a participant follows the recipe on a test shoot.

**Later, out of the MVP:** an image-embedding model to rank which of the user's photos are closest to the reference style.

## 11. Server function and security

- One function per route: `/api/analyze` and `/api/synthesize`.
- The function holds the API key in an environment variable. It validates payload size and type, applies rate limits per IP, and enforces a daily spending cap, returning a clear error when exceeded.
- Do not log image data or request bodies.
- Optional developer mode: allow a user-supplied API key kept only in memory in the browser, for testing without the server cap. Do not persist it.
- CORS locked to the app's own origin.

## 12. UI

Keep it simple and fast to build.

1. **Upload page:** drop zone, batch progress, summary of "new / already seen / failed."
2. **References and recipe page (main page):** upload references, view the gap report and the labeled recipe, download the recipe card.
3. **Profile page:** latest profile with statistics charts and the labeled narrative. Each claim shows its label and links to the cited photos.
4. **Data page:** export JSON, import JSON, toggle thumbnails, delete everything.
5. **Changes page (Priority 1):** comparison of the latest two snapshots.

On first use, show a short privacy notice: images are reduced and sent to a model provider for analysis, nothing is stored by default, and data lives only in this browser. Ask for consent before enabling thumbnails.

Photos without stored thumbnails display as a neutral placeholder with filename and key EXIF values.

## 13. Data persistence and safety

- Browser storage can be cleared by the user or the browser. Request persistent storage where supported and tell the user if it is denied.
- **Export and import is required** and must round-trip without loss. Include `schemaVersion` and migrate on import.
- Delete-all must remove everything: IndexedDB, caches and settings.
- Warn before any action that would lose data.

## 14. Milestones and acceptance criteria

Each milestone should end with something runnable. Keep commits small.

**M1: Single photo.**
Upload one JPEG, read EXIF, resize, analyze through the server function, show validated JSON.
*Accept:* EXIF is read before resize and matches a known sample. Invalid model output triggers one retry, then a clear failure.

**M2: Batches, dedupe and storage.**
Queue with concurrency and retries, progress UI, IndexedDB via repositories, SHA-256 dedupe.
*Accept:* uploading the same 20 photos twice analyzes each only once. A deliberately failed call can be retried. 100 photos complete without freezing the UI.

**M3: Statistics and profile.**
Compute all statistics, snapshot storage, synthesis with the validator.
*Accept:* unit tests cover every statistic. A report with an uncited tip or a mismatched number is rejected.

**M4: References and recipe (Priority 0).**
Reference upload, gap computation in code, recipe generation, recipe validator, recipe card download.
*Accept:* no reference image is stored. Every recipe item points to a measured gap or observed feature and cites the user's photos. A recipe that breaks any validator rule is rejected or flagged. Setting claims about references are always labeled `Inferred`.

**M5: Data controls and safety (Priority 0).**
Export, import, delete-all, privacy notice, rate limits and spending cap.
*Accept:* export then delete then import restores identical data. The production bundle contains no API key. This milestone must be finished before any public link is shared for testing.

**M6: Iteration and change report (Priority 1; first to cut).**
A second batch updates the profile, and the app computes a diff against the previous snapshot (snapshots themselves are already stored from M3).
*Accept:* only new photos are analyzed, deltas are computed in code, and the narrative cites them.

**M7: Evaluation support.**
Download the profile report and the recipe card as Markdown, with a neutral format so outputs can be compared blind against a general chat assistant and, where possible, a dedicated critique tool.
*Accept:* downloads contain no images, no reference photos and no personal data beyond what the user chose to include.

## 15. Testing

- **Unit tests:** statistics, dedupe, schema validation, report validator, recipe validator (one test per rejection rule), gap computation, import and export round trip.
- **Fixtures:** a small set of sample JPEGs with known EXIF, including one with no EXIF.
- **One end-to-end flow:** upload batch, upload references, see recipe, download recipe card. If Priority 1 is built, also upload a second batch and see changes.
- **Manual checks:** low-bandwidth upload, closing the tab mid-batch, denied storage permission.

## 16. Risks to keep visible while building

- **Invented facts.** The validator in 9.2 is the main defense. Do not weaken it to make output look nicer.
- **Flattery.** If reports lack a specific weakness, treat it as a bug.
- **Inconsistency between runs.** Never re-analyze a stored photo unless the prompt version changes, and then only on explicit user action.
- **Cost abuse.** Server limits are required before any public link is shared.
- **Privacy.** No image storage by default, no identification of people, no logging of images.
- **Browser limits.** Large batches can strain memory. Process files one at a time and release object URLs.
- **Weak differentiation.** Other tools already critique photos and show statistics. If the recipe is generic, the project has no advantage. Treat any recipe item that could apply to anyone as a bug, and keep the recipe validator strict.
- **Wrong inference from references.** Reference photos have no EXIF and downsized images cannot show focus or noise. Keep recipe claims labeled `Inferred` and never present them as facts.

## 17. Mid-term: accounts

Not in the MVP, but do not block it:
- Keep all storage behind repository interfaces.
- Use UUIDs and timestamps on every record.
- Keep exports in a documented JSON format that a future server import can reuse.
- Do not rely on IndexedDB-specific behavior outside the repository layer.

## 18. Working agreements

- Ask before adding a major dependency or changing the stack.
- Write tests for pure functions as you write them.
- Do not store or print secrets. Use environment variables and a documented `.env.example`.
- Keep a short `DECISIONS.md` for choices made and why.
- If the spec seems wrong or something here is unclear, say so instead of guessing.

## 19. Open questions (do not decide silently)

1. Hosting target for the front end and server function.
2. Which models to use for per-photo analysis and for synthesis, after checking current options and cost.
3. Default for thumbnails: off (current plan) or prompted at first run.
4. Batch limits per request and daily spending cap values.
5. Whether to include an embedding-based similarity feature before the evaluation, or leave it for later.
6. Exact definitions of "specific" and "consistent," to be fixed with the evaluation plan before testing.
7. How strict the recipe validator should be: reject and regenerate once and then flag (current plan), or block the recipe entirely.
8. Whether the recipe can suggest settings at all, or only light, framing and subject choices, given that settings advice for references is only inferred.

## 20. Suggested repository layout

```
framecoach/
  README.md
  DECISIONS.md
  .env.example
  src/
    app/            UI pages and routes
    lib/
      exif/         EXIF reading
      image/        resize, color stats
      hash/         content hashing
      stats/        statistics (pure functions)
      queue/        upload queue and retry
      validation/   zod schemas, report validator
      storage/      repository interfaces and IndexedDB implementation
      prompts/      versioned prompts
    api/            serverless functions (analyze, synthesize)
  tests/
    fixtures/       sample JPEGs
```
