# Project Journal: FrameCoach

**How this journal was written.** Entries for weeks 3 to 5 were reconstructed afterwards from my conversation history with Claude (written Wednesday of week 6, Nov 4, 2026). 

\---

## Week 3 (Oct 12 to 18): From a first idea to a new project direction

**Done**

* **Oct 15, first idea review.** Applied the brainstorming scaffold to my first idea, StartLine, an AI race finder for outdoor athletes. I asked where the AI actually is. A script or an API can collect events from structured sources like RunSignup, so a language model only helps with messy free-text listings from small clubs. The recommendation part looked weak at the start because a new product has no user data.
* **Oct 15, where the new idea started.** Tested connecting Claude to a Google Drive folder of about 135 photos and asked for style, shooting and lens advice.
* **Oct 15 to 18, pivot and feasibility.** Decided to change my project and asked Claude how this would differ from uploading photos to a chat assistant. Researched how to connect to people's photos.
* **Oct 18, first documents.** Wrote proposal v1 with the course scaffold and a developer specification v1.
* **Oct 18, competitor research.** Searched for products similar to my idea to see where it overlaps and what is new.

**Worked**

* Splitting the AI part (reading messy pages, describing images) from the non-AI part (APIs, scripts, camera data).
* Once connected, Claude read camera data inside the photo files and gave a specific style summary and lens suggestions.
* Claude's honest answer that for one small set of photos, a chat assistant is already good. This told me value must come from scale, memory, camera data measured by code, and reference comparison.

**Did not work (dead ends and failures)**

* Claude first could not find the Drive folder because it was in "Shared with me", not My Drive. The folder also belonged to another account, so I should not describe those photos as my own.
* Reading an image through the connector returned empty content. The only workaround was to download each file and decode it separately. Because of file sizes, only 8 of about 135 photos were analyzed, and nothing carried over to a later conversation.
* Google Photos: since 2025, third-party apps can no longer read a whole library, only photos the user picks.
* Automatic Google Drive access for the public: needs a restricted permission with verification and a security assessment, which cannot finish in one semester.
* A desktop program watching a local folder: possible, but too much friction for users.
* My v1 proposal said nobody tracks how a photographer's habits change. That was wrong, since some competitors track rating trends and camera statistics. Claude helped me notice this.

**Decisions**

* I decided to switch my final project from StartLine to photography analysis and coaching, because the exercise showed two gaps: scale and memory.
* I defined the inputs: users upload their own photos and photos they want to imitate (or point to a folder that updates automatically), with periodic reports, and advice that includes how to shoot to match a style they like.
* After the feasibility research, I chose a web app with uploads, no accounts, and data stored in the user's browser. Accounts are a mid-term goal. The target user is any photography hobbyist.
* After the competitor research (Claude's research, I accepted the conclusion), I decided to make reference-based coaching the main feature and to demote the change report to a lower priority.

**Next:** Rewrite the proposal and specification around the new main feature, then have Claude Code build a demo.

**Evidence:** proposal v1, developer specification v1, competitor notes, the Drive exercise conversation.

\---

## Week 4 (Oct 19 to 25): Revised documents and the first build

**Done**

* **Between Oct 18 and 22 (exact date not recorded).** Wrote proposal v2 and developer specification v2: moved reference coaching to the top priority, reordered the milestones, added a recipe data model, and added a recipe validator that rejects advice with no evidence.
* **About Oct 22.** Gave the v2 specification to Claude Code. It reported building a demo: a server that holds the API key and forwards requests, a browser front end, local storage, camera data reading, duplicate detection, image shrinking, a recipe generator, a validator, a downloadable recipe card, rate limits, and export and delete of data.

**Worked**

* The specification gave Claude Code enough structure to produce a working layout in one pass.

**Did not work / concerns**

* The computer had no Node installed, so Claude Code replaced the planned React and TypeScript stack with plain JavaScript and a Python server. My specification said to ask before changing the stack, and it did not ask. *\[Decide and write here whether you accept this or want to port it later.]*
* The validator checks focal length, aperture, and reference settings by keyword matching, which is weaker than a real meaning check. Since my main promise is that the app never invents settings, this is a risk to test.
* Only the server startup was confirmed. Image analysis and recipe generation have not been run with a real API key.

**Not built yet:** change report, thumbnails, a written profile summary, automated tests.

**Next:** Run the app with a real key and test it.

**Evidence:** proposal v2, developer specification v2, Claude Code's build report.

\---

## Week 5 (Oct 26 to Nov 1)

Spent pretty much the entire week studying like crazy for midterms... No project progress to report.

The mid-quarter update instructions came out toward the end of the week, but I was too swamped with exams to work on them right away, so I pushed that to Week 6.
