# Project Journal: FrameCoach

**How this journal was written.** Entries for weeks 3 to 5 were reconstructed afterwards from my conversation history with Claude (written Wednesday of week 6, Nov 4, 2026). 


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


## Week 4 (Oct 19 to 25): Revised documents and the first build

**Done**

* **Between Oct 18 and 22 (exact date not recorded).** Wrote proposal v2 and developer specification v2: moved reference coaching to the top priority, reordered the milestones, added a recipe data model, and added a recipe validator that rejects advice with no evidence.
* **About Oct 22.** Gave the v2 specification to Claude Code. It reported building a demo: a server that holds the API key and forwards requests, a browser front end, local storage, camera data reading, duplicate detection, image shrinking, a recipe generator, a validator, a downloadable recipe card, rate limits, and export and delete of data.

**Worked**

* The specification gave Claude Code enough structure to produce a working layout in one pass.

**Did not work / concerns**

* The computer had no Node installed, so Claude Code replaced the planned React and TypeScript stack with plain JavaScript and a Python server. My specification said to ask before changing the stack, and it did not ask. *\[Decide and write here whether you accept this or want to port it later.]*
* The validator checks focal length, aperture, and reference settings by keyword matching, which is weaker than a real meaning check. Since my main promise is that the app never invents settings, this is a risk to test.
* Only the server startup was confirmed. Image analysis and recipe generation have no# Project Journal: FrameCoach


## Week 5 (Oct 26 to Nov 1)

Spent pretty much the entire week studying like crazy for midterms... No project progress to report.

The mid-quarter update instructions came out toward the end of the week, but I was too swamped with exams to work on them right away, so I pushed that to Week 6.


## Week 6 (Nov 2 to 8, in progress; last updated Wednesday Nov 4)

**Done**
- Read the mid-quarter update rubric, listed my weakest areas, and set up this repository, the journal and the README.
- **Nov 4, first real runs of the app** with a live API key. Three recipes were generated within about 40 minutes (run 1 at 17:14, run 2 at 17:37, run 3 at 17:51 local time).
- Ran a comparison against a general chat assistant using the same photos.
- Designed, but did not build, a new feature: a comparison of my own photos over time using their timestamps.

**Bugs found and what I learned**
1. **"No EXIF" on every photo.** I noticed before generating any recipe that the page said none of my photos had camera data, although I knew they should. Claude Code first suspected the library had not loaded, then that my photos had been compressed. Both were ruled out (the library loaded, and it read a 7.3 MB original in the browser console). It then scanned 151 photos in my folder: 150 had full camera data. It reproduced the failure in a real browser and found the cause: passing a `pick` option to the library's read function throws an error in this library version, and an empty `catch {}` hid the error, so the page just showed "no EXIF". The fix was to read everything and choose the fields in our own code. After re-uploading, the camera data appeared. Lesson: a silent failure looked like a normal result, so I had no way to tell "no data" from "could not read".
2. **JSON error, then truncated output.** The first recipe attempt failed with a JSON parse error. Claude Code added a check for why the model stopped and printed the raw text. The real cause was that the output was cut off at the length limit. The limits were raised (photo analysis 700 to 1500, recipe 2500 to 6000). Lesson: ask the model for long structured output and the length budget matters; diagnose before changing parameters.

**What the three recipes showed**
- **Run 1** (13 photos, 9 references): no gear advice, because the camera data was empty.
- **Run 2** (15 photos, 10 references): gear advice appeared after the fix. Problems found: two validator warnings that look like false alarms (keyword matching), specific exposure numbers such as "-0.7 EV" labeled as measured although the model had guessed them, confidence ratings that looked too high for such small samples, and photo IDs that changed between uploads.
- **Run 3** (after Claude Code's changes in response to these problems): photo IDs are now stable and files are shown by name, specific numbers go in a separate "starting point" field, confidence is set by code from sample size, and the wording is plain English. New issues: fewer gear suggestions than run 2, and the diagnosis of what holds my photos back became more general ("pale, wide frames") and lost the more useful point about tiny subjects.
- The reference photos have consecutive file numbers, so they may come from a single shoot. If so, differences like "darker and more vertical" may reflect that shoot, not a style I can learn from. I have not resolved this.

**Comparison with a general chat assistant (15 photos, 10 references, one run each)**
- Condition A was a plain request. Condition B gave the chat assistant the same rules as FrameCoach. [Confirm who designed these two prompts; I believe Claude Code did and I ran them.]
- A did not use file names and presented guesses about the references as facts. B followed the rules about as well as FrameCoach run 3.
- FrameCoach found two gaps that B missed (vertical frames and colour), both measured by code, and it used my actual lens range. B gave a sharper diagnosis of my main weakness, covered more of my photos, and covered topics FrameCoach did not (depth of field, empty sky).
- Conclusion for now: at this size, FrameCoach clearly beats an unguided request but does not clearly beat a well-prompted chat assistant. This rests on one run per condition, so it is a first result, not a finding.

**New idea: change over time**
- I asked for advice that compares my own photos over time using their timestamps, not only against the references. Claude Code's design: the code splits the photos into periods and measures the trends, the model only explains in plain words, the output describes what changed and whether it is moving toward the references, and it does not say I "improved" or "got worse" because photos cannot measure skill. Photos without a date are counted and reported, since a camera clock can be wrong (one of my files is dated 2019).
- Risks I noted: changes may come from different places, seasons or cameras rather than from my habits; the 100 photos I choose are not a random sample; periods with few photos cannot support a trend; editing in Lightroom can change what the code measures.
- Status: design only. Nothing is built or tested.

**Not yet verified**
- The test page for the validator (I have not recorded its result).
- Whether the recipe's descriptions of my photos are true (I have not checked them against the photos).
- Whether results repeat: each recipe was run once under changing settings, so I cannot yet separate the effect of the changes from randomness.

**Decisions**
- Based on my feedback, Claude Code changed the recipe to plain language, limited advice to things done while shooting, and removed the "share of photos with people" measure. *[Paste your original message to Claude Code here as evidence of your own judgment.]*
- I decided to run the scale test in week 7 rather than now, because the update is due Saturday and the checks above come first.

**Next (this week)**
- Hand-check descriptions in the recipe against my photos and record right and wrong.
- Record the validator test result and take screenshots of the fixed EXIF display.
- Write the update, annotate 2 to 4 conversations, and record the video once the Saturday question is released.

**Open question:** the Saturday-section video question is not released yet.


## Week 7 plan: scale test (planned, not yet done)

**Question:** Does FrameCoach handle a large collection of photos better than a chat assistant?

**What I have seen so far:** in my first attempt to upload photos to the chat assistant, I found it accepts at most 20 images in one upload. I do not yet know the total it will hold in one conversation, whether it actually sees every photo, or whether its answers get worse as the number grows. Sources I read disagree: the help page says 20 files per chat, while other sources describe 100 files per conversation with 20 images per message.

**My prediction (to be tested, not a conclusion):** because uploads are limited to 20 at a time, a collection of about 100 photos will need at least five batches in the chat assistant, while FrameCoach can take the whole set at once and also uses camera data and timestamps that the chat assistant cannot read reliably. So I expect FrameCoach to be better for large, accumulated collections.

**How I will test it**
1. Start a fresh chat. Upload the same 100 photos in batches of 20, asking after each batch for a count and the file names. Record the point where uploads fail, the exact error message (with a screenshot), the number of batches, and the time spent.
2. If all photos upload, check whether the assistant truly saw all of them: ask for the full file list and ask about a few randomly chosen photos.
3. Ask the same advice question at about 20, 50 and 100 photos, and compare the specificity and accuracy of the answers.
4. Ask the assistant how my style has changed over time, and see whether it can without camera dates.
5. Run FrameCoach on the same 100 photos and record time, cost (from the API console), whether every photo was analyzed, and any errors.
6. Repeat each condition three times if time allows, and record which model and plan I used.

**What would count as support or not**
- Supported if FrameCoach covers all 100 photos with accurate results and the chat assistant clearly needs much more effort or loses accuracy at that size.
- Not supported if the chat assistant handles all 100 photos about as well. In that case I will say so and report that FrameCoach's advantage lies elsewhere (for example measured camera data, stable file references, or time comparison), or that I did not find one.
- A 20-image upload limit alone does not prove an advantage. It only matters if it makes the task slower or less accurate.

