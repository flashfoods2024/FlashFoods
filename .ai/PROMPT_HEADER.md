# FlashFoods AI Development Context

Before making any changes to this codebase, you MUST read the following files in order:

1. `.ai/STATUS.md` — Current project state and known issues
2. `.ai/ARCHITECTURE.md` — System architecture overview
3. `.ai/BUSINESS_RULES.md` — Business rules and constraints
4. `.ai/DEPENDENCY_GRAPH.md` — Module dependency map
5. `.ai/COMMON_PATTERNS.md` — Coding patterns and conventions

## Critical Rules

1. **Preserve all existing functionality** — Do not break backward compatibility.
2. **Follow existing patterns** — Use the same coding style as the rest of the codebase.
3. **Keep changes minimal** — Modify only the files necessary for the task.
4. **No duplicate logic** — Reuse existing utilities and helpers.
5. **Validate after every change** — Run the server and verify no errors.

## Tech Stack
- Express 5 (ES modules)
- MongoDB + Mongoose ODM
- EJS templates (server-side rendering)
- Socket.IO (real-time)
- Playwright (E2E testing)
- Payments: Razorpay, Easebuzz, PhonePe
- AI Menu Import: Gemini Vision API
