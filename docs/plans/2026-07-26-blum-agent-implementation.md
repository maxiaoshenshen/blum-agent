# Blum Agent Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build and publish a Chinese-first Blum hardware expert that gives role-aware, source-grounded answers through the user-selected `claude-opus-5` provider.

**Architecture:** A vinext/Next.js interface posts a bounded conversation and optional image to a Worker-compatible route handler. Pure TypeScript domain modules retrieve curated official Blum context, classify risk, build the model request, strip provider reasoning tags, and normalize the result; the UI renders role guidance, sources, confidence, errors, and recoverable next steps.

**Tech Stack:** TypeScript 5.9, React 19, Next.js-compatible vinext, Cloudflare Workers, Vitest, Testing Library, ESLint, custom OpenAI-compatible Chat Completions provider.

---

### Task 1: Test harness and repository hygiene

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `.env.example`

**Steps:**
1. Add Vitest, jsdom, Testing Library and user-event as development dependencies.
2. Add `test:unit`, `test:watch`, `typecheck`, and `check` scripts without removing the Sites build scripts.
3. Configure jsdom tests and the `@/` alias.
4. Ignore vinext, Wrangler, coverage and local environment artifacts.
5. Run `npm run test:unit -- --run --passWithNoTests`; expect the harness to exit successfully.
6. Commit with `test: configure unit and component test harness`.

### Task 2: Blum domain knowledge and retrieval

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/roles.ts`
- Create: `src/domain/knowledge.ts`
- Create: `src/domain/retrieval.ts`
- Test: `src/domain/retrieval.test.ts`

**Steps:**
1. Write failing tests for six roles, product-family keyword matching, Chinese/English aliases, result ranking, generic fallback sources, and precision-risk classification.
2. Run `npm run test:unit -- src/domain/retrieval.test.ts`; verify RED failures are caused by missing modules.
3. Implement typed role definitions, product families, official source records, normalized matching, bounded top-result retrieval and risk classification.
4. Run the targeted test; verify GREEN.
5. Refactor duplicate keyword logic while keeping the test green.
6. Commit with `feat: add official Blum knowledge retrieval`.

### Task 3: Provider boundary and response safety

**Files:**
- Create: `src/agent/schema.ts`
- Create: `src/agent/prompt.ts`
- Create: `src/agent/provider.ts`
- Create: `src/agent/sanitize.ts`
- Test: `src/agent/provider.test.ts`
- Test: `src/agent/schema.test.ts`

**Steps:**
1. Write failing tests for empty/oversized requests, invalid roles, unsupported image media types, history trimming, prompt grounding, `<think>` removal, fenced-answer cleanup, upstream timeout and upstream error mapping.
2. Run the two targeted tests and verify RED.
3. Implement request parsing with explicit limits, role/context prompt construction, Chat Completions request creation, timeout handling and safe error types.
4. Strip all `<think>` blocks before returning content; never expose upstream request bodies, headers or keys.
5. Run targeted tests and verify GREEN.
6. Commit with `feat: add safe provider adapter`.

### Task 4: Chat service and API contract

**Files:**
- Create: `src/agent/chat.ts`
- Create: `src/agent/chat.test.ts`
- Create: `app/api/chat/route.ts`
- Create: `app/api/chat/route.test.ts`

**Steps:**
1. Write failing tests for grounded live answers, missing-provider demo fallback, high-risk `needs-review`, source propagation and stable JSON error responses.
2. Run targeted tests and verify RED.
3. Implement dependency-injected chat orchestration and the Worker-compatible POST route.
4. Ensure environment access uses `PROVIDER_BASE_URL`, `PROVIDER_API_KEY`, and `PROVIDER_MODEL`; default model must never override an explicitly configured model.
5. Run targeted tests and verify GREEN.
6. Commit with `feat: expose grounded Blum chat API`.

### Task 5: Role-aware conversation interface

**Files:**
- Create: `components/blum-agent.tsx`
- Create: `components/blum-agent.test.tsx`
- Create: `components/icons.tsx`
- Modify: `app/page.tsx`

**Steps:**
1. Write failing component tests for role selection, starter prompts, message submission, response rendering, source links, confidence labels, image attachment validation, attachment removal and recoverable API errors.
2. Run the component test and verify RED.
3. Implement one client workspace with six role controls, task starters, product navigation, message timeline, accessible composer, image preview and loading/error states.
4. Render model text as text with preserved line breaks; do not use raw HTML.
5. Run the component test and verify GREEN.
6. Commit with `feat: build Blum Agent conversation workspace`.

### Task 6: Distinctive responsive visual system

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Delete: `public/favicon.svg`
- Delete: `app/_sites-preview/SkeletonPreview.tsx`
- Delete: `app/_sites-preview/preview.css`
- Modify: `package.json`
- Modify: `package-lock.json`

**Steps:**
1. Add a failing rendered-HTML assertion for the final title, Chinese language and removal of starter markers.
2. Replace the starter with an industrial/editorial “precision workshop” system: warm ivory, graphite, signal orange, technical grid, sharp radii, strong typographic hierarchy and reduced-motion support.
3. Make the two-column workspace collapse cleanly on phones; keep 44px touch targets and visible keyboard focus.
4. Replace starter metadata, remove the generic starter icon and remove `react-loading-skeleton`.
5. Generate one site-specific social preview with imagegen, inspect it, and include it only if text is correct.
6. Run unit tests, lint and production build; verify GREEN.
7. Commit with `style: finish Blum Agent product experience`.

### Task 7: Integration, documentation and security checks

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-07-23-blum-agent-design.md`
- Create: `docs/official-sources.md`
- Modify: `tests/rendered-html.test.mjs`

**Steps:**
1. Document purpose, supported roles, provider variables, local run, tests, deployment, privacy behavior, official-source policy and known limitations.
2. Record the selected custom provider contract without storing its credential.
3. Expand the rendered build test to verify the production shell and API route artifact.
4. Run `npm run check`, `npm test`, and `npm run build`; all must pass without warnings caused by application code.
5. Inspect `git diff --check`, tracked files and secret patterns; confirm `.env.local` is ignored and no key appears in Git.
6. Commit with `docs: complete Blum Agent delivery guide`.

### Task 8: Publish and final verification

**Files:**
- Modify: `.openai/hosting.json` only with the opaque Sites `project_id`.

**Steps:**
1. Create the Sites project once, store only its opaque `project_id`, and configure the three runtime provider variables through Sites.
2. Commit the exact validated source and push using the Sites source credential.
3. Package the exact commit with the Sites helper, save a version and deploy it privately.
4. Poll deployment status until terminal and open the successful production URL in Codex.
5. Run one live production query that asks a broad Blum product question and verify the answer, source cards and absence of `<think>` output.
6. Use `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch` before final delivery.
