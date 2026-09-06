# ORION AI — `WORKFLOW.md`

## 1. Purpose

Build the first complete AI system for **ORION**, an existing personal life-management web app.

Freebuff currently has **zero context about this AI feature**. Before making changes, it must inspect the existing repository and understand the current implementation.

The goal is to add an AI layer that can:

1. Act as a chatbot.
2. Understand the user's existing ORION data.
3. Understand which ORION page the user is currently using.
4. Perform actions that a normal user can perform through the application.
5. Use controlled application functions rather than directly modifying Supabase.
6. Ask for confirmation when an action is significant or externally consequential.
7. Maintain useful AI memory.
8. Be extensible so future ORION pages can be added later.

**Do not build features for pages that do not currently exist.**

At the time of this workflow, the relevant existing ORION pages are:

* **Time Management**
* **Fitness**

Do not assume Finance, Study, Journal, Travel, Goals, or other planned pages currently exist.

---

# 2. First Task: Audit the Existing Application

Before implementing anything, inspect the repository thoroughly.

Determine:

* Current Next.js structure
* React components
* Routing
* API/server architecture
* Supabase setup
* Authentication
* Database schema
* Existing database functions
* Existing API routes
* Existing application functions
* Existing Time Management functionality
* Existing Fitness functionality
* Existing mobile UI
* Existing desktop UI
* Existing AI-related code, if any

Do not make assumptions based on this workflow where the repository provides more accurate information.

The repository is the source of truth for what currently exists.

Do not rewrite functioning features simply to add AI.

---

# 3. Current ORION Scope

Only the following existing application areas should be integrated initially.

## Time Management

Inspect the actual implementation and expose the existing functionality to AI.

Known functionality includes:

* Calendar
* Fixed calendar commitments
* Tasks
* Habits
* Upcoming tasks/habits
* Dragging tasks/habits onto the calendar
* Available/free time
* Habit durations
* Task durations where implemented
* Curfew behaviour
* Scheduling logic

Important existing design principle:

**The calendar represents fixed commitments and available time.**

Tasks and habits should not automatically become calendar events unless the user or AI explicitly schedules them.

The AI must use the existing Time Management logic rather than creating a second scheduling system.

---

# 4. Fitness Scope

Inspect the actual existing Fitness implementation.

The AI should integrate with whatever currently exists, including relevant functionality such as:

* Workout history
* Hevy import
* Exercises
* Sets
* Reps
* Weight
* Strength progression
* PRs
* E1RM/1RM data where implemented
* Muscle-volume tracking
* Direct/indirect muscle work where implemented
* Moving averages where implemented
* Sleep data where implemented
* Weight data where implemented
* Physique data/photos where implemented

Do not invent database tables or functionality that does not exist.

If the repository differs from the above description, follow the repository.

---

# 5. AI's Role

The AI should become an **application-level assistant for ORION**.

It is not just a question-answering chatbot.

The user should eventually be able to say:

> "What should I do this evening?"

> "Can I fit everything in today?"

> "Move my gym session to Sunday."

> "How has my bench progressed?"

> "How much volume have I done this week?"

> "Mark Mandarin complete."

> "Add a task to revise history."

The AI should understand the request, retrieve relevant ORION data, and use ORION's existing application functions to perform actions.

---

# 6. Fundamental Architecture

Use this architecture:

```text
                         ORION AI
                            │
                     Model Provider
                            │
                     AI Server Layer
                            │
              ┌─────────────┴─────────────┐
              │                           │
        Context System               Tool System
              │                           │
      ┌───────┴────────┐          ┌───────┴────────┐
      │                │          │                │
Global Context    Page Context   Read Tools     Action Tools
      │                │          │                │
      └────────────────┴──────────┴────────────────┘
                            │
                   ORION Application Logic
                            │
                         Supabase
```

The AI must **not** have unrestricted database access.

Never implement:

```text
AI → arbitrary SQL → Supabase
```

Instead:

```text
AI → approved tool → application logic → Supabase
```

---

# 7. Model Provider

Use a provider abstraction.

The initial model should be:

**Gemini 3.7 Flash**

Do not hard-code Gemini throughout the application.

Create an AI provider/model abstraction so the model can later be changed to:

* DeepSeek
* Claude
* OpenAI
* another compatible model

without rewriting:

* tools
* memory
* permissions
* UI
* application logic

The Gemini API key must remain server-side.

---

# 8. AI Chat Interface

Build a global AI chat interface.

It must work on both desktop and mobile.

### Desktop

Use a dedicated AI panel/sidebar or equivalent existing ORION UI pattern.

### Mobile

Use an accessible AI button that opens the chat interface.

The chatbot should support:

* Text input
* Streaming responses
* Conversation history
* Loading state
* Tool execution state
* Action results
* Confirmation cards
* Cancel buttons
* Undo where practical
* Page-specific suggested prompts

The AI should feel like part of ORION rather than an external website embedded into it.

---

# 9. Page-Aware AI

The AI must know what page the user is currently on.

Do not create separate AI systems for each page.

Use one AI system with contextual information.

For example:

```text
current_page: time_management
current_section: calendar
selected_date: ...
selected_event: ...
```

or:

```text
current_page: fitness
current_section: strength
selected_exercise: bench_press
date_range: ...
```

The exact context structure should be based on the existing implementation.

---

# 10. Time Management Context

When the AI is being used from Time Management, it should be able to understand relevant information such as:

* Current date/time
* Today's calendar
* Fixed commitments
* Free periods
* Tasks
* Habits
* Task durations
* Habit durations
* Priorities
* Curfew
* Completion status

For example:

> "Can I fit Mandarin and gym in today?"

The AI should retrieve the actual calendar/tasks/habits and calculate whether they fit.

It should not guess.

---

# 11. Fitness Context

When the AI is being used from Fitness, it should automatically receive lightweight context about the current Fitness UI.

For example:

```text
current_page: fitness
current_section: strength
selected_exercise: bench_press
date_range: 12_weeks
```

The AI can then retrieve the relevant detailed data through tools.

For example:

> "Why has this stalled?"

If the user is looking at bench press progression, the AI should understand that "this" refers to bench press.

---

# 12. Context Loading

Do not send the entire ORION database to the AI with every request.

Use a combination of:

### Automatic context

Small amounts of relevant information such as:

* Current page
* Current section
* Selected item
* Current date/time
* Relevant UI state

### Tool retrieval

The AI requests detailed information when necessary.

Example:

```text
User:
"How has my bench progressed?"

AI:
→ current page = Fitness
→ selected exercise = Bench Press
→ call get_exercise_progress()
→ analyse returned data
→ answer
```

This keeps requests efficient and accurate.

---

# 13. Tool System

Create a controlled AI tool registry.

Tools should correspond to actual ORION application capabilities.

Do not duplicate existing business logic unnecessarily.

Where an existing function already performs an operation, make that function reusable by the AI.

The preferred architecture is:

```text
Normal UI ───────┐
                 ├──→ Shared ORION Function → Supabase
AI Tool ─────────┘
```

This ensures the UI and AI behave consistently.

---

# 14. Time Management Tools

Based on the actual existing implementation, expose appropriate tools such as:

```text
get_calendar
get_event
get_tasks
get_task
get_habits
get_habit
find_free_time
find_conflicts
create_task
update_task
complete_task
uncomplete_task
delete_task
create_habit
update_habit
complete_habit
uncomplete_habit
create_event
update_event
move_event
delete_event
```

Only implement tools for functions that actually exist.

If an equivalent function already exists, reuse it.

---

# 15. Fitness Tools

Based on the actual implementation, expose appropriate read/action tools such as:

```text
get_fitness_summary
get_workout_history
get_workout
get_exercise_progress
get_strength_progress
get_prs
get_muscle_volume
get_sleep_data
get_weight_history
get_physique_history
```

Where existing functionality supports it, expose appropriate mutation/import functions.

For example:

```text
import_workout_data
create_workout_log
update_workout_log
```

Again, inspect the repository first.

Do not invent functionality simply because it appears in this list.

---

# 16. Tool Permissions

Every tool must have a permission level.

## Level 0 — Read

No confirmation.

Examples:

* Reading calendar
* Reading tasks
* Reading habits
* Reading workouts
* Analysing strength
* Reading fitness history

---

## Level 1 — Simple/reversible

Can execute immediately.

Examples:

* Marking a task complete
* Marking a habit complete
* Creating a simple task
* Moving a task

After execution, show the user what happened.

Example:

```text
✓ Task created

Revise Mandarin
Tomorrow
30 minutes
```

---

## Level 2 — Significant changes

Require confirmation.

Examples:

* Reorganising an entire day
* Moving multiple calendar events
* Creating a large schedule
* Making many changes simultaneously

Show a confirmation card:

```text
Proposed changes

Tuesday
17:00 Mandarin — 30 min
17:30 Gym — 90 min

Wednesday
18:00 History — 45 min

[Apply] [Cancel]
```

Nothing is changed until the user presses Apply.

---

## Level 3 — External/high-impact

Always require explicit confirmation.

This is primarily for future external integrations.

Do not implement unnecessary external actions in the current phase.

---

# 17. Action Transparency

Whenever the AI changes ORION, show the user what happened.

Example:

```text
✓ Calendar updated

Gym moved:
Saturday 18:00
→
Sunday 14:00
```

Do not silently make changes.

If an operation fails, explicitly tell the user.

Never claim success when a tool failed.

---

# 18. Undo

Where practical, provide an Undo action after reversible mutations.

Example:

```text
✓ Task moved to tomorrow

[Undo]
```

Build this into the action layer where possible.

---

# 19. Multi-Step Actions

The AI should be capable of performing several actions as part of one request.

Example:

> "Sort out my evening."

Possible process:

```text
1. Read calendar
2. Read incomplete tasks
3. Read incomplete habits
4. Read durations
5. Calculate available time
6. Create proposed schedule
7. Ask for confirmation
8. Apply approved changes
```

The AI should not blindly execute a large number of changes without respecting the permission system.

---

# 20. Memory

Build a structured AI memory system.

Do not save every conversation permanently.

Memory should contain useful persistent information such as:

```text
Goals
Preferences
Routines
Important facts
Ongoing projects
```

The memory system should be user-specific.

Provide controlled operations such as:

```text
get_memory
create_memory
update_memory
delete_memory
```

The AI should not automatically store arbitrary sensitive or irrelevant information.

---

# 21. Conversation History

Persist AI conversations.

Store enough information to support:

* Returning to previous conversations
* Contextual continuity
* Tool history
* Relevant summaries

Do not send the entire conversation history to the model unnecessarily.

Use summaries or selective retrieval where appropriate.

---

# 22. External Features

Do not build travel, finance, study, journal, or other future-module integrations now simply because they are planned for ORION.

However, the AI architecture must make future tool domains easy to add.

For example:

```text
Tool Registry
├── time_management
├── fitness
├── future_finance
├── future_study
├── future_journal
└── future_external_tools
```

Only `time_management` and `fitness` should be implemented as ORION domain integrations in this phase.

---

# 23. Security

The AI system must respect existing ORION security.

Requirements:

* Server-side API key
* Authenticated AI requests
* User-specific data
* Existing Supabase RLS
* Server-side validation
* Tool argument validation
* No arbitrary SQL
* No privileged database bypass
* No cross-user data access

Do not weaken existing security to simplify AI implementation.

---

# 24. Existing Functionality Must Not Break

AI implementation must not break:

* Time Management
* Calendar
* Tasks
* Habits
* Fitness
* Hevy import
* Existing authentication
* Existing mobile UI
* Existing desktop UI
* Existing Supabase functionality

Do not rewrite existing functionality unless necessary.

If refactoring is required, preserve existing behaviour.

---

# 25. Performance

The AI must not make ORION generally slower.

Requirements:

* Lazy-load AI functionality where appropriate
* Stream responses
* Avoid loading AI code unnecessarily on initial page load
* Minimise database queries
* Only retrieve relevant context
* Avoid sending huge prompts unnecessarily
* Cache appropriate data
* Avoid blocking normal navigation

The existing ORION application should remain responsive when AI is not being used.

---

# 26. Mobile Behaviour

The AI must work properly on mobile.

Test:

* Opening/closing AI
* Keyboard behaviour
* Scrolling
* Streaming
* Long messages
* Tool status
* Confirmation cards
* Apply/cancel buttons
* Undo
* Navigation while AI is open

The AI interface must not interfere with the existing mobile navigation.

---

# 27. Testing

Test the AI at three levels.

### Tool tests

Every tool:

* Valid input
* Invalid input
* Missing data
* Authentication
* Permission
* Database errors

### AI tests

Natural-language requests such as:

```text
"What do I have today?"

"Can I fit everything in today?"

"Add a task to revise Mandarin."

"Mark this habit complete."

"Move my gym session to Sunday."

"How has my bench progressed?"

"How much volume did I do this week?"
```

### Safety tests

Verify:

* AI cannot execute arbitrary SQL.
* AI cannot access another user.
* AI cannot bypass confirmation.
* AI cannot claim failed actions succeeded.
* AI cannot modify data outside its tool permissions.

---

# 28. Development Sequence

Do not attempt everything at once.

## Phase 1 — Repository audit

Understand the existing implementation completely.

Do not modify functionality yet.

---

## Phase 2 — AI foundation

Implement:

* Provider abstraction
* Gemini integration
* Server-side AI endpoint
* Authentication
* Basic chatbot
* Streaming

At this point the AI should be able to hold a conversation but should not modify ORION.

---

## Phase 3 — Context

Implement:

* Global context
* Current page context
* Current section
* Selected item/date where available
* Time/date context

---

## Phase 4 — Read tools

Implement Time Management and Fitness read tools.

Verify that the AI can answer questions using real ORION data.

---

## Phase 5 — Action tools

Implement controlled mutations.

Start with simple actions.

---

## Phase 6 — Confirmation system

Add:

* Permission levels
* Confirmation cards
* Apply
* Cancel
* Action result
* Undo where possible

---

## Phase 7 — Memory

Add:

* Persistent memory
* Conversation persistence
* Relevant memory retrieval

---

## Phase 8 — Advanced intelligence

Implement:

* Daily planning
* Free-time analysis
* Multi-step scheduling
* Fitness analysis
* Cross-module reasoning between Time Management and Fitness

---

## Phase 9 — Optimisation

Improve:

* Speed
* Token usage
* Context efficiency
* Mobile performance
* Reliability

---

# 29. Future Extensibility

The architecture must make it straightforward to add future ORION modules.

When Finance eventually exists, for example, it should be possible to add:

```text
finance tools
+
finance page context
+
finance-specific prompts
```

without rebuilding the AI architecture.

Do not implement those future modules now.

---

# 30. Definition of Done

The first AI implementation is complete when the user can open ORION AI and naturally ask questions or give commands relating to the **existing Time Management and Fitness systems**.

Examples:

> "What do I have left to do today?"

> "Can I fit everything in before my curfew?"

> "Schedule my Mandarin and gym into my free time."

> "Move my gym session to Sunday."

> "Mark this task complete."

> "How has my bench progressed?"

> "How many sets have I done this week?"

> "What does my recent training look like?"

The AI must:

1. Understand the user's request.
2. Understand the current ORION context.
3. Retrieve the necessary real data.
4. Use controlled ORION functions.
5. Perform permitted actions.
6. Ask for confirmation when required.
7. Clearly show what it changed.
8. Never fabricate results.
9. Never directly manipulate the database.
10. Never break existing ORION functionality.

---

# 31. Critical Rule for Freebuff

**Do not treat this document as a description of features that should be invented.**

Use the existing repository as the source of truth.

This workflow describes the **AI architecture and intended integration**.

Before creating tools, inspect the actual code and determine:

* What already exists.
* What functions already exist.
* What data already exists.
* What database tables actually exist.
* What UI actions actually exist.
* How those actions currently work.

Then expose those existing capabilities to the AI through safe, reusable functions.

**The AI should operate ORION through the same underlying functionality that the normal UI uses.**

Do not create duplicate business logic.

Do not invent pages.

Do not invent database tables.

Do not rewrite working systems unnecessarily.

The end result should be:

```text
                  ORION
                    │
        ┌───────────┴───────────┐
        │                       │
     Normal UI              ORION AI
        │                       │
        └───────────┬───────────┘
                    │
             Shared Functions
                    │
                 Supabase
```

The AI is therefore another way of operating the **existing ORION application**, not a separate application layered on top of it.
