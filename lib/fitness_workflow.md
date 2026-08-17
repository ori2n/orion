# ORION FITNESS — IMPLEMENTATION WORKFLOW

**Project:** ORION Fitness workout-system rebuild
**Primary objective:** Replace manual workout logging with a reliable manual Hevy export → ORION import pipeline.

# 0. READ THIS FIRST

This document is the **single source of truth** for this Fitness rebuild.

Do **not** attempt to complete every stage in one run.

Work through the stages sequentially.

For **every stage**:

1. Read the entire stage.
2. Inspect the relevant existing ORION codebase.
3. Inspect the relevant current Supabase/database schema.
4. Ask the user any questions genuinely necessary to remove ambiguity.
5. Explain your understanding of the stage and what you intend to do.
6. Wait for the user's confirmation.
7. Implement only that stage.
8. Run the project's existing validation/build/type-check/test processes.
9. Check for regressions.
10. Report what changed in simple language.
11. Create a Git checkpoint/commit.
12. **STOP.**

Do not automatically continue to the next stage.

If a requirement conflicts with the actual codebase or actual Hevy export, **stop and ask the user rather than inventing a product decision.**

Do not ask the user technical questions that can reasonably be answered by inspecting the codebase.

---

# 1. PRODUCT VISION

The intended workflow is:

**Hevy → export workout history → upload to ORION → process → store workout data → calculate deterministic metrics → confirm import**

The user continues logging workouts in Hevy.

ORION is **not** intended to become a second workout logger.

The user should not have to manually enter every workout into ORION.

The initial implementation is **data-first**.

The underlying data/import system must be reliable before significant effort is spent on the final Fitness UI.

---

# 2. CURRENT FITNESS SCOPE

For this project, Fitness consists of:

* Hevy workout data
* Physique photos
* Bodyweight

## Do NOT modify

The existing:

* Physique photo system
* Bodyweight system

These should remain **completely untouched** during the workout-system rebuild.

## Not currently in scope

Do not implement or redesign:

* Sleep tracking
* Activity tracking
* Automatic Hevy API synchronisation
* AI workout analysis
* Failure tracking
* Complex indirect-muscle modelling
* Final Fitness dashboard
* Final Fitness visual redesign

These can be added later.

---

# 3. HEVY EXPORT

The user's current Hevy export is known to be:

* Approximately **86 KB**
* A text document exported from the Hevy iPhone app
* The user's **entire Hevy workout history**
* Approximately **50 workouts**

This means an import may contain the user's complete history every time.

**Do not assume the export is incremental.**

The importer therefore MUST be designed to safely process the same complete history repeatedly.

When the actual export file is provided, inspect the real file before finalising assumptions about its format.

Determine:

* Exact file format
* Exact fields
* Workout structure
* Exercise structure
* Set structure
* Dates
* Workout names
* Exercise names
* Muscle groups
* Weight
* Reps
* Workout duration
* IDs, if present
* PR information, if present
* Any other useful information

Do not invent fields that do not exist in the actual export.

Do not throw away useful source data simply because the current UI does not use it.

---

# 4. IMPORT METHOD

The system is **manual Hevy export import only**.

Do NOT build:

* Hevy API integration
* Automatic syncing
* Scheduled syncing
* Background Hevy account connection

The intended process is:

1. User exports from Hevy.
2. User uploads the file to ORION.
3. ORION processes it.
4. ORION stores the resulting workout data.
5. ORION calculates deterministic Fitness metrics.
6. ORION provides a simple confirmation/diagnostic result.
7. The raw export does not need to remain permanent primary storage.

---

# 5. IDEMPOTENT IMPORTS

Because every Hevy export may contain the entire workout history, repeated imports are expected.

The importer must therefore be **idempotent**.

Example:

### First import

50 workouts checked
50 new workouts

### Second import of the exact same file

50 workouts checked
0 new workouts
0 duplicates

### Later import

50 old workouts recognised
4 new workouts imported

If an existing workout has genuinely changed in a later export, update the existing record rather than creating a duplicate.

Use reliable identifiers from the export where available.

Do not build an unnecessarily complicated exercise identity/mapping system.

If two differently named exercises are treated as separate exercises, that is acceptable for the initial system.

A simple manual rename/edit mechanism can be added later.

---

# 6. OLD MANUAL WORKOUT SYSTEM

The old manual workout logger is obsolete.

Inspect the existing workout implementation and database.

The goal is a **clean Hevy-based workout foundation**, not preservation of the old manual workout system.

Where old workout-specific code/tables are obsolete, replace or rebuild them.

Do not create unnecessary compatibility layers merely to preserve the old manual logger.

However:

* Do not touch physique photos.
* Do not touch bodyweight.
* Do not touch unrelated ORION functionality.

Use the technically cleanest approach after inspecting the actual codebase.

---

# 7. DATA MODEL

The conceptual data structure is:

**User**
→ **Workouts**
→ **Exercises**
→ **Sets**

The system must preserve individual workout/set information.

It must be possible to answer:

> What workout did I do on 16 May?

Then:

> Which exercises did I perform?

Then:

> What sets did I perform?

Example:

**16 May 2026 — Push**

Bench Press:

* 60 kg × 10
* 70 kg × 8
* 75 kg × 6

The underlying database must preserve this level of detail.

The exact implementation/schema should be determined after inspecting:

1. Existing ORION architecture
2. Existing Supabase schema
3. Actual Hevy export

Do not force a predefined database design if the existing architecture suggests a cleaner solution.

---

# 8. DATA TO RETAIN

The system should retain all useful workout information available from Hevy.

At minimum, this includes:

* Workout date
* Workout name
* Exercise
* Muscle group
* Sets
* Reps
* Weight

Useful additional information should be retained where available.

### Not required as a core metric

* Rest time
* RPE

RPE means **Rate of Perceived Exertion**.

It is not currently important to the user and does not need to be incorporated into the Fitness metrics.

Workout duration can be retained if available, but it is not a priority metric.

Volume does not necessarily need to be stored as a redundant raw field because it can be calculated from:

**weight × reps**

However, it should be available as a calculated metric.

---

# 9. RAW EXPORT STORAGE

The raw Hevy export should not become permanent primary workout storage.

The system should:

1. Receive the file.
2. Parse it.
3. Validate it.
4. Store the actual processed workout data.
5. Calculate required metrics.
6. Record import diagnostics/provenance.
7. Retain the latest three processed import records/files as appropriate.
8. Allow specific imports to be deleted.
9. Remove/compress older raw files where appropriate.

The processed workout data must remain available.

The objective is to avoid wasting storage while keeping enough information for diagnostics and import history.

---

# 10. IMPORT PROVENANCE

Each import should have a lightweight history record.

It should be possible to see:

* When the import happened
* What date range it covered
* How many workouts were checked
* How many were new
* How many already existed
* How many were updated
* How many sets were processed
* Warnings
* Other useful diagnostics

The system should retain enough provenance to support **specific-import deletion**.

---

# 11. IMPORT DIAGNOSTICS

The initial UI does NOT need to be a fancy dashboard.

After processing, it should provide a simple confirmation that allows the user to know the data was successfully received and processed.

Example:

> **Import complete**
>
> Workouts checked: 142
> New workouts: 4
> Existing workouts: 138
> Updated workouts: 0
> Sets processed: 1,847
> Weight PRs: 4
> Warnings: 0
> Date range: 12 Jan 2026 → 16 Aug 2026
> Volume since previous import: 10,420 kg
> Days since previous import: 14

The numbers above are examples only.

The actual diagnostics must use real imported data.

---

# 12. IMPORT WARNINGS

Do NOT silently ignore unsupported or unexpected data.

If something cannot be processed:

* Continue processing everything that can safely be processed.
* Record an import warning.
* Display the warning in diagnostics.
* Clearly explain what happened.

Example:

> **Import warning:** Exercise X could not be assigned a muscle group because the source file did not contain one.

Do not allow an obscure unsupported field to silently corrupt the import.

If the problem is significant enough that the data cannot be safely processed, stop the import and report the problem.

---

# 13. VERIFYING PROCESSED DATA

There must be a simple way to verify that the importer actually processed the original workout information.

The user/developer must be able to inspect individual records during the development/verification stages.

Example:

**16 May 2026 — Push**

Bench Press

* Set 1 — 60 kg × 10
* Set 2 — 70 kg × 8
* Set 3 — 75 kg × 6

This is primarily a verification/debugging mechanism.

It is **not** the final Fitness UI.

---

# 14. VOLUME

Volume is:

**Weight × Reps**

Example:

70 kg × 8 = 560 kg

Volume should be available at useful levels such as:

* Exercise
* Workout
* Muscle
* Week
* 4-week period
* 8-week period

Do not unnecessarily store duplicate versions of calculations.

---

# 15. HEAVIEST WEIGHT

For every exercise, calculate:

**Heaviest weight ever lifted**

This is the primary strength/PR metric.

Do not create a complicated "best set" system.

The user specifically cares about the **heaviest weight lifted**.

---

# 16. PR SYSTEM

A normal PR means:

**Highest weight ever lifted for an exercise.**

Only weight PRs are required initially.

Do NOT create:

* Rep PRs
* Estimated 1RM PRs

A heavier weight should automatically become a weight PR.

Manual override should be possible later/simple enough to correct incorrect data.

---

# 17. ESTIMATED 1RM

Estimated 1RM and manual 1RM are **separate variables**.

Example:

**Manual 1RM:** 100.0 kg
**Estimated 1RM:** 100.2 kg

The estimated value must never overwrite the manual value.

Calculate estimated 1RM deterministically from appropriate workout sets.

Do not use AI.

The exact formula can be chosen using a standard, sensible 1RM estimation method after inspecting the available data.

Estimated 1RM is a **display/analysis metric**, not a PR.

Manual 1RM entry should be supported.

The final UI for this will be decided later.

---

# 18. EXERCISE PROGRESSION

Every exercise should have chronological performance history.

Example:

Bench Press:

* 1 Aug — 70 kg × 8
* 8 Aug — 72.5 kg × 7
* 15 Aug — 75 kg × 6

The underlying data should make progression analysis possible.

The final progression UI comes later.

---

# 19. MUSCLE / HYPERTROPHY DATA

Use the muscle-group information supplied by Hevy where available.

Keep the initial hypertrophy model simple.

Track:

* **Direct muscle work**
* Sets per muscle per week
* Training frequency
* Weekly volume
* 4-week moving average
* 8-week moving average

Do NOT calculate indirect muscle work initially.

Do NOT attempt a complicated hypertrophy score.

Do NOT track failure.

The user always generally trains sets to failure, but failure is not currently a metric because Hevy does not provide the necessary information.

The main hypertrophy metric is:

> **Sets per muscle per week**

The intended training frequency is:

> **Approximately twice per week per muscle**

This should be represented as a configurable target/preference rather than being inferred by AI.

---

# 20. FUTURE INTERPRETATION

The deterministic Fitness system should calculate useful information now so future ORION AI can interpret it later.

For example, future AI could receive:

* Sets per muscle
* Training frequency
* 4-week average
* 8-week average
* Volume
* Exercise progression
* PRs

The AI should not have to repeatedly calculate basic statistics from raw workout data.

Do not implement this AI layer now.

---

# 21. BODYWEIGHT

Bodyweight is an existing Fitness feature.

**Do not modify it.**

Do not migrate it.

Do not redesign it.

Do not rebuild it.

Only integrate with it later if genuinely required.

---

# 22. PHYSIQUE PHOTOS

Physique photos are an existing Fitness feature.

**Do not modify them.**

Do not migrate them.

Do not redesign them.

Do not rebuild them.

They remain part of Fitness.

---

# 23. PERFORMANCE

The current export is approximately:

**86 KB / ~50 workouts**

This is a very small dataset.

Do NOT over-engineer the system.

Do not introduce unnecessary:

* Background processing infrastructure
* Queue systems
* Complicated caching
* Microservices
* AI processing
* Hevy API integrations
* Massive summary tables

Use the existing ORION/Supabase architecture efficiently.

The website should remain fast.

Do not load the user's entire workout history into the browser unnecessarily.

Query only the data required.

Do not recalculate the entire history on every page render if avoidable.

Use database indexes appropriately.

Only introduce caching/materialised summaries if actual performance testing demonstrates a need.

Prioritise:

**simple + correct + fast**

over:

**complex + theoretically scalable**

---

# 24. IMPORT PIPELINE

The import pipeline should conceptually be:

```text
Upload
  ↓
Validate file
  ↓
Parse file
  ↓
Normalise data
  ↓
Validate required information
  ↓
Identify existing records
  ↓
Create new records
  ↓
Update changed records
  ↓
Calculate deterministic metrics
  ↓
Record provenance
  ↓
Record diagnostics/warnings
  ↓
Complete import
  ↓
Confirm success
```

Use transactions or equivalent safeguards where appropriate so a failed import does not leave the database in an inconsistent state.

---

# 25. IMPORT DELETION

Normal deletion should operate on **specific imports**.

Example:

> Delete Import #12

This should remove/revert data associated with that import without destroying unrelated workout history.

There must NOT be a normal one-click:

> Delete all Fitness data

feature.

If a full wipe mechanism is technically necessary for development/emergency use, it must require deliberate, multiple confirmation/override steps and must not be exposed as a normal user action.

---

# 26. SUPABASE SECURITY

Use the existing ORION Supabase configuration.

The workflow must NEVER require the user to give Freebuff:

* `service_role` key
* `sb_secret_...` key
* Any other elevated secret key

Do not expose elevated Supabase credentials to the browser.

If a client-side key genuinely needs to be referenced, use a placeholder:

```text
SUPABASE_PUBLISHABLE_KEY = [PASTE YOUR PUBLISHABLE/ANON KEY HERE]
```

or use the existing project's environment variables.

**Prefer the existing environment-variable configuration over putting credentials into this workflow.**

Never:

* Hard-code credentials
* Commit credentials to Git
* Put secret keys into frontend code
* Put secret keys into this workflow

Inspect the existing ORION environment-variable configuration before deciding that any new credential is needed.

---

# 27. SUPABASE MIGRATIONS

Freebuff should create the required Supabase/database migrations.

Do not make the user manually invent SQL.

Before changing the database:

1. Inspect the current schema.
2. Identify obsolete workout structures.
3. Identify what must remain.
4. Preserve bodyweight.
5. Preserve physique photos.
6. Design the cleanest required migration.
7. Apply it using the project's established migration process.
8. Verify the resulting schema.

Do not blindly delete tables.

Do not modify unrelated tables.

---

# 28. EXISTING ORION CODEBASE

Freebuff must inspect the actual ORION codebase before making implementation decisions.

Do not assume the current architecture.

Use the existing:

* Next.js
* React
* Node.js
* Supabase
* Existing project conventions

structure.

Only modify files genuinely relevant to Fitness.

Do not redesign unrelated ORION pages.

Do not refactor the entire application.

If a shared component or utility genuinely needs changing, explain why in the final report.

---

# 29. FITNESS PAGE SCOPE

The initial implementation should only work on the relevant **Fitness page/code**.

Do not use this project as an opportunity to modify:

* Calendar
* Time Management
* Finance
* Journal
* Other unrelated ORION pages

If a change outside Fitness is technically unavoidable, explain why.

Do not leave unrelated regressions behind.

---

# 30. INITIAL UI

During the initial import stages, the UI only needs to provide:

* File upload
* Processing status
* Simple success confirmation
* Basic diagnostics
* Necessary verification/debugging capability

Do not spend significant time designing the final Fitness dashboard yet.

The user explicitly wants to design the final UI **after the underlying data exists and has been proven correct.**

---

# 31. MOBILE UI

The eventual Fitness UI should be:

**Mobile-first.**

Do not simply build desktop first and squeeze it onto a phone.

However, this is a later stage.

Do not let mobile visual design delay the underlying import/data system.

---

# 32. GIT CHECKPOINTS

After each completed stage:

1. Run validation.
2. Confirm relevant functionality works.
3. Review changed files.
4. Create a Git checkpoint.

Suggested commit naming:

```text
fitness: complete stage 1 hevy import foundation
fitness: complete stage 2 import diagnostics
fitness: complete stage 3 real hevy validation
fitness: complete stage 4 fitness calculations
fitness: complete stage 5 fitness ui
fitness: complete stage 6 fitness ai integration
```

Do not commit:

* Supabase secrets
* Private credentials
* Private Hevy exports

unless the user explicitly requests this.

---

# 33. REGRESSION PROTECTION

The existing ORION application must continue working.

Use the project's normal:

* Build
* TypeScript checking
* Linting
* Tests, if present

Do not declare a stage complete if the application does not build.

If a regression occurs:

1. Determine whether the current stage caused it.
2. Fix it if reasonably within scope.
3. If fixing it requires a significant product decision, stop and ask the user.

Do not silently ignore regressions.

---

# 34. START-OF-STAGE PROCESS

At the beginning of every stage:

### Step 1

Read the complete stage.

### Step 2

Inspect the relevant existing code/database.

### Step 3

Determine whether anything genuinely needs clarification.

### Step 4

Ask only necessary questions.

### Step 5

Explain:

* What you found
* What you think needs to happen
* What you are about to change

### Step 6

Wait for confirmation.

### Step 7

Implement.

Do not ask unnecessary questions where the answer can be determined from the codebase or data.

Do not make the user decide ordinary technical implementation details.

---

# 35. END-OF-STAGE REPORT

After every stage, report in simple language.

Use:

## What I changed

Explain what changed without unnecessary technical jargon.

## What this means

Explain what the user can now do.

## What I tested

List the actual checks performed.

## Problems

List warnings, unresolved issues, or things that could not be verified.

## Git checkpoint

State the commit/checkpoint created.

## Status

```text
STAGE X COMPLETE — WAITING FOR USER APPROVAL
```

Then **STOP**.

Do not automatically continue.

The report should be understandable to someone who needs to understand the project without being an expert developer.

---

# 36. IF SOMETHING GOES WRONG

If the actual codebase or actual Hevy file conflicts with this workflow:

**STOP.**

Report:

### What we expected

...

### What actually exists

...

### Why this matters

...

### Proposed solution

...

### What decision I need from you

...

Do not silently change the product specification.

---

# 37. STAGES

# STAGE 0 — INSPECT AND PLAN

## Objective

Understand the current ORION Fitness implementation before changing it.

Inspect:

* Fitness page
* Existing workout components
* Existing workout database tables
* Existing migrations
* Existing Supabase configuration
* Physique photo system
* Bodyweight system
* Existing build/test configuration
* Existing project conventions

Determine:

* What old workout functionality exists
* What should be removed
* What should remain
* Where the importer belongs
* What database changes will be required
* How the existing architecture should be used

Do not implement the new workout system yet.

Do not modify physique photos or bodyweight.

## Completion criteria

A clear implementation plan exists based on the actual codebase.

No unnecessary production functionality has been modified.

## CHECKPOINT

Report findings.

Create Git checkpoint.

STOP.

---

# STAGE 1 — HEVY IMPORT FOUNDATION

## Objective

Build the underlying Hevy workout data system.

Implement:

* New/clean workout data model
* Exercise data
* Individual sets
* Import records/provenance
* Required database constraints/indexes
* Supabase migrations
* Hevy parser
* Import pipeline
* Duplicate detection
* Update handling
* Basic deterministic calculations

Do not build the final Fitness dashboard.

## The importer must support

* Full-history imports
* Repeated imports
* New workouts
* Existing workouts
* Changed workouts
* Individual sets
* Dates
* Exercises
* Weights
* Reps
* Muscle information where available

## Completion criteria

A real Hevy export can be processed successfully.

The system stores the underlying workout data accurately.

Repeated import does not duplicate records.

## Initial UI

Only provide enough UI to:

* Upload
* Process
* Confirm
* Show basic diagnostics

Do not polish the dashboard.

## CHECKPOINT

Report.

Git checkpoint.

STOP.

---

# STAGE 2 — IMPORT DIAGNOSTICS AND HISTORY

## Objective

Make the importer verifiable and manageable.

Implement:

* Import confirmation
* Import diagnostics
* Import history
* Latest 3 import records/files as appropriate
* Warnings
* Specific-import deletion
* Record verification

Diagnostics should show things such as:

* Import time
* Workouts checked
* New workouts
* Existing workouts
* Updated workouts
* Sets processed
* Date range
* Warnings
* Weight PRs
* Volume since previous import
* Days since previous import

## Required tests

Test:

1. First full-history import.
2. Exact same file imported again.
3. Later export containing new workouts.
4. Changed existing workout.
5. Unsupported/unknown data.
6. Specific import deletion.
7. Database consistency afterward.

## CHECKPOINT

Report.

Git checkpoint.

STOP.

---

# STAGE 3 — REAL HEVY DATA VALIDATION

## Objective

Validate the implementation against the user's actual Hevy export.

Inspect the actual export in detail.

Confirm:

* Exact schema
* Workout count
* Date range
* Exercise count
* Set count
* Muscle-group data
* Weight data
* Rep data
* IDs
* Any unusual fields

Take known workouts from the source export and verify that ORION contains the same information.

Verify:

* Workout date
* Workout name
* Exercises
* Sets
* Weight
* Reps

Do not redesign the UI.

## CHECKPOINT

Report.

Git checkpoint.

STOP.

---

# STAGE 4 — FITNESS CALCULATION ENGINE

## Objective

Build and validate the deterministic Fitness calculations.

Implement/validate:

* Volume
* Heaviest weight
* Weight PRs
* Estimated 1RM
* Manual 1RM
* Exercise progression
* Sets per muscle/week
* Muscle frequency
* Weekly volume
* 4-week moving average
* 8-week moving average
* Training-frequency comparison against approximately 2×/week

Do not add AI.

Do not build the final dashboard.

## CHECKPOINT

Report.

Git checkpoint.

STOP.

---

# STAGE 5 — FITNESS UI

## Objective

Only now design the actual Fitness interface using the real data.

Create a polished, fast, mobile-first Fitness experience.

Possible areas:

* Fitness overview
* Workout history
* Exercise progression
* PRs
* Estimated/manual 1RM
* Muscle/hypertrophy information
* Bodyweight
* Physique photos

Do not assume every calculated metric must appear on the main screen.

Use the actual data and user feedback to decide the final presentation.

The UI should feel intentional rather than like a collection of database tables.

## CHECKPOINT

Report.

Git checkpoint.

STOP.

---

# STAGE 6 — FUTURE AI INTEGRATION

## Objective

Only after the deterministic Fitness system is stable, connect ORION AI to the processed Fitness data.

AI should consume processed information such as:

* Training frequency
* Sets per muscle
* 4-week averages
* 8-week averages
* Volume
* Exercise progression
* PRs
* Bodyweight

AI should interpret this information.

AI should NOT be responsible for basic workout calculations.

The core Fitness system must remain fully functional if AI is unavailable.

## CHECKPOINT

Report.

Git checkpoint.

STOP.

---

# 38. FINAL NON-NEGOTIABLE RULES

Do not:

* Build Hevy API integration.
* Build automatic Hevy synchronisation.
* Give Freebuff a Supabase service-role/secret key.
* Hard-code credentials.
* Commit credentials.
* Put secrets into frontend code.
* Add AI to workout processing.
* Build the final dashboard before the data foundation is proven.
* Modify physique photos.
* Modify bodyweight.
* Add sleep now.
* Add activities now.
* Add failure tracking now.
* Build an unnecessary exercise identity/mapping system.
* Over-engineer an 86 KB export.
* Duplicate full-history imports.
* Silently discard unsupported data.
* Create an easy one-click full Fitness wipe.
* Modify unrelated ORION pages unnecessarily.
* Skip validation.
* Claim success without testing.
* Automatically move to the next stage.
* Make unnecessary technical decisions the user should not have to make.
* Let a stage continue after encountering a significant unresolved product decision.

The priority order is:

> **1. Reliable Hevy import**
> **2. Correct permanent workout data**
> **3. Correct deterministic Fitness calculations**
> **4. Excellent Fitness UI**
> **5. AI interpretation**

The fundamental principle is:

> **Log workouts in Hevy. ORION imports and understands the data. The user should not have to manually log the same workout twice.**
