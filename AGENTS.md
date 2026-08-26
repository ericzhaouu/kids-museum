<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project Handoff: 兮爷的小小博物馆

This file is the primary handoff document for coding agents and other Harness
tools. Read it before changing code. `README.md` is the operator-facing runbook;
this file explains product intent, architecture, invariants, and safe extension
points.

## 1. Product definition

This project is a private online museum for a child's artwork and handmade
creations. It is deliberately not a generic photo gallery.

The product preserves:

- the artwork image;
- creation date and age at creation;
- medium and tags;
- the child's original words, optionally as private audio;
- a separate parent note;
- reviewed editorial copy and exhibition context.

The default visitor experience is an immersive 2D exhibition with a foyer,
rooms, framed artwork, close-look dialogs, audio playback, keyboard/touch/wheel
navigation, and an accessible low-motion/simple mode.

### Product roles

- **Curator / parent**: signs in, uploads and edits work, reviews AI
  suggestions, creates exhibitions, manages invitations, exports backups, and
  can permanently delete the museum.
- **Family visitor**: enters through a time-limited invitation and receives an
  HttpOnly visitor session. Visitors are read-only.
- **Child / artist**: owns the creative voice but has no account in v1. The
  child's words must remain distinguishable from parent and AI-authored text.
- **AI curator assistant**: may generate suggestions only. It cannot publish or
  silently replace content.

### Current scope

Implemented:

- Magic Link curator authentication.
- Private family invitation links with expiration and revocation.
- Batch artwork ingestion with browser-side EXIF/GPS removal, rotation, crop,
  focal point, and three WebP variants.
- Private audio upload, server-side duration validation, transcription, and
  exhibition playback.
- Artwork-level AI title, description, and tag suggestions.
- Exhibition-level AI title, foyer introduction, and room-introduction
  suggestions.
- Explicit accept/reject/stale review workflows for all AI content.
- Multiple exhibitions with draft/published/archived states.
- Per-placement `featured`, `size`, and `framePreset` display configuration.
- Desktop/mobile preview, publication validation, immersive mode, and simple
  mode.
- Privacy-safe WeChat/Xiaohongshu poster generation.
- Consistent private ZIP backup containing metadata plus registered media.
- Permanent museum deletion with tombstones and retryable media cleanup.
- Local Docker deployment of Supabase, the Next.js app, and a deterministic AI
  mock.

Not implemented:

- Import/restore from a backup ZIP.
- Production cloud deployment and real SMTP/AI provider configuration.
- Multi-child or multi-curator ownership.
- Public comments, likes, or open social discovery.
- Video editing for handmade-work tutorials.

## 2. User journeys

### Curator creates an artwork

1. The curator signs in by email.
2. The browser selects one or more images.
3. Images are rotated/cropped and re-encoded locally to sanitized WebP.
4. The API creates an empty private artwork draft and records text notes.
5. The API creates a persistent upload session and returns signed upload
   descriptors for exact temporary paths.
6. The browser uploads sanitized media directly to private Storage.
7. The server downloads temporary objects, validates their real headers,
   dimensions, MIME, size, and audio duration, writes versioned final objects,
   and commits metadata through a service-role-only RPC.
8. Temporary and replaced objects enter `media_cleanup_jobs`.

Never replace this flow with base64 media in an API request. It was designed to
avoid serverless request-size limits and to keep unsanitized originals off the
server.

### AI editorial flow

1. AI reads only the sanitized display image, medium, and child quote.
2. Parent notes, names, invitation data, and credentials are excluded.
3. Provider output is validated and stored as `pending`.
4. Suggestions carry an input/source version.
5. Editing source content makes older pending suggestions `stale`.
6. Accept/reject is performed by a locking database RPC, exactly once.
7. Only accepted suggestions update canonical artwork/exhibition content.

### Family visit flow

1. The curator creates a time-limited invitation.
2. The plaintext token appears only in the generated URL; the database stores
   its hash.
3. `/visit/[token]` validates the invitation and creates a hashed visitor
   session.
4. The browser receives an HttpOnly, SameSite=Lax visitor cookie.
5. Every private read checks that both invitation and visitor session remain
   active.
6. Revoking an invitation also revokes its existing visitor sessions.

### Backup and deletion

- Backup uses a single database snapshot RPC to avoid cross-table pagination
  drift, then streams registered media into a versioned ZIP.
- The ZIP must never include invitation hashes, visitor-session hashes, signed
  URLs, or provider credentials.
- Permanent deletion requires explicit confirmation, preserves the Auth user,
  creates a tombstone, deletes museum rows, and queues every registered final
  and temporary object for service-role cleanup.

## 3. Technology and runtime

- Next.js 16.3, App Router, React 19, TypeScript 5.
- Tailwind CSS 4 plus extensive project CSS in `src/app/globals.css`.
- Supabase Auth, PostgreSQL, PostgREST, Storage, RLS, and RPCs.
- OpenAI-compatible vision and transcription endpoints.
- Vitest for unit/integration tests and Playwright for browser E2E.
- Docker Desktop with Linux containers for the local Supabase stack.
- Next.js standalone multi-stage image plus a local AI mock image.

### Local service topology

| Service | Address |
| --- | --- |
| Museum app | `http://localhost:3000` |
| Supabase API used by browser | `http://127.0.0.1:54321` |
| PostgreSQL | `127.0.0.1:54322` |
| Supabase Studio | `http://127.0.0.1:54323` |
| Mailpit | `http://127.0.0.1:54324` |
| AI mock inside Compose | `http://ai-mock:4010/v1` |
| Supabase used by app container | `http://host.docker.internal:54321` |

The public and internal Supabase URLs are intentionally different. Browser code
must use `NEXT_PUBLIC_SUPABASE_URL`; server code may use
`SUPABASE_INTERNAL_URL`.

All browser and server Supabase clients use the fixed auth storage key in
`src/lib/supabase/auth-storage.ts`. Do not remove it: the public and internal
URLs otherwise generate different PKCE cookie keys and Magic Link login fails.

## 4. Repository map

```text
kids-museum/
├─ src/app/                    Next.js pages and route handlers
│  ├─ api/                     Authenticated JSON/media APIs
│  ├─ auth/callback/           Magic Link PKCE callback
│  ├─ studio/                  Curator workspace
│  └─ visit/[token]/           Family invitation entry
├─ src/components/
│  ├─ museum-experience.tsx    Visitor exhibition UI
│  ├─ studio-dashboard.tsx     Curator shell and collection UI
│  ├─ studio-artwork-dialogs.tsx
│  └─ studio-exhibitions-panel.tsx
├─ src/lib/
│  ├─ artworks/                Contracts, direct upload, validation, saga logic
│  ├─ exhibitions/             Exhibition API/editing services
│  ├─ supabase/                Browser/server/admin clients and config
│  ├─ museum-access.ts         Curator/visitor access resolution
│  ├─ media-cleanup.ts         Retryable Storage deletion worker
│  ├─ museum-backup.ts         ZIP structure and privacy checks
│  └─ request-origin.ts        Same-origin redirect normalization
├─ supabase/
│  ├─ migrations/              Append-only SQL history, currently 0001-0017
│  ├─ config.toml              Local Auth/Storage/ports
│  └─ seed.sql                 Version-stable synthetic seed data
├─ tests/
│  ├─ integration/             Real local Supabase RLS/RPC/Storage tests
│  ├─ e2e/                     Preview, login, and invitation browser tests
│  └─ support/                 Synthetic Supabase test helpers
├─ tools/                      Bootstrap, setup, mock, cleanup, verification
├─ Dockerfile                  `web` and `ai-mock` targets
├─ compose.local.yml           Local app and AI containers
└─ README.md                   Human operating instructions
```

## 5. Primary data model

### Museum and content

- `museum_profiles`: one museum per Auth owner in v1.
- `artworks`: canonical reviewed title/description, status, date, age label,
  medium, and `source_version`.
- `artwork_assets`: one registered asset per kind:
  `original/display/thumbnail/audio`.
- `artwork_notes`: distinct `child`, `parent`, and `transcript` sources.
- `tags`, `artwork_tags`: museum-scoped tag catalog and links.

### AI review

- `ai_suggestions`: artwork suggestions with type, input version, JSON content,
  provider request ID, review state, and timestamps.
- `exhibition_ai_suggestions`: exhibition/room suggestions with
  `curation_version`.

Valid review states are `pending`, `accepted`, `rejected`, and `stale`.

### Curation

- `exhibitions`: title, subtitle, introduction, state, theme/version,
  `curation_version`, publish/archive timestamps.
- `exhibition_rooms`: ordered rooms and room copy.
- `room_artworks`: ordered placements with strict `display_config`.

`display_config` allows only:

```ts
{
  featured: boolean;
  size: "small" | "medium" | "large";
  framePreset: "classic" | "shadow" | "float" | "storybook";
}
```

### Access and operations

- `invitations`: invitation hash, label, expiration, and revocation.
- `visitor_sessions`: session hash, expiration, revocation, last seen.
- `audit_events`: sensitive action history.
- `media_upload_sessions`: exact authorized temp paths and upload state.
- `media_cleanup_jobs`: retryable Storage cleanup.
- `museum_tombstones`: deletion evidence and cleanup status.

## 6. Migration history and rules

Migrations are append-only. Never rewrite a migration that may have been applied
outside a disposable local database. Add a new numbered migration.

Important milestones:

- `0001`: base schema, RLS, private bucket.
- `0003`: composite tenant integrity, path and publication checks.
- `0004`: curator update/delete/save RPCs and invitation revocation.
- `0005-0006`: artwork source versions and atomic AI review.
- `0007-0008`: expanded curation, display config, publication rules, atomic
  exhibition review.
- `0009-0010`: tombstones, cleanup jobs, leases, cleanup path security.
- `0011-0013`: artwork update saga, persistent upload sessions, service-role-only
  asset commit, exact temporary-path authorization.
- `0014`: single-transaction backup snapshot.
- `0015`: recovery of expired/failed/uncleaned upload sessions.
- `0016`: explicit API role grants required by PostgREST.
- `0017`: fixes ambiguous Storage policy column references by explicitly using
  `storage.objects.name`.

Do not remove `0016` or `0017`. Both were discovered only when the full local
Supabase stack was actually started.

## 7. API surface

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/health` | GET | App and Supabase health |
| `/auth/callback` | GET | Magic Link code exchange |
| `/visit/[token]` | GET | Invitation exchange and visitor cookie |
| `/api/museum` | GET/POST/DELETE | Read, initialize, permanently delete museum |
| `/api/artworks` | GET/POST | Collection list and atomic draft creation |
| `/api/artworks/[id]` | PATCH/DELETE | Artwork saga update and deletion |
| `/api/artworks/[id]/uploads/authorize` | POST | Persistent signed temp upload |
| `/api/artworks/[id]/uploads/cleanup` | POST | Session-bound interrupted upload cleanup |
| `/api/artworks/[id]/transcription` | POST | Private audio transcription suggestion |
| `/api/artworks/export` | GET | Consistent private backup ZIP |
| `/api/ai/suggest` | GET/POST | Read/generate artwork suggestions |
| `/api/ai/suggest/[id]` | PATCH | Review artwork suggestion |
| `/api/exhibitions` | GET/POST | List/save/publish exhibitions |
| `/api/exhibitions/[id]` | PATCH/DELETE | Archive/delete exhibition |
| `/api/exhibitions/[id]/suggestions` | GET/POST | Exhibition suggestions |
| `/api/exhibitions/suggestions/[id]` | PATCH | Review exhibition suggestion |
| `/api/invitations` | GET/POST | List/create family invitations |
| `/api/invitations/[id]` | DELETE | Revoke invitation and sessions |

All API input and provider output must be validated with Zod or equivalent
strict validation.

## 8. Security and privacy invariants

Treat these as acceptance criteria, not implementation suggestions:

1. The configured museum is private by default.
2. Tenant isolation must exist in RLS and database constraints/RPCs, not only in
   UI or API filters.
3. `SUPABASE_SERVICE_ROLE_KEY` is server-only.
4. `museum-private` must remain a private bucket.
5. Browser writes are limited to exact, active, persisted temp upload paths.
6. Formal asset rows are committed only by the service-role path after
   server-side inspection.
7. Unsanitized original photos must never leave the browser.
8. Image and audio claims from the browser are untrusted; revalidate bytes on
   the server.
9. Audio is limited to supported MIME types, 12 MB, and 600 seconds.
10. Cleanup APIs accept an upload session ID, never arbitrary object paths.
11. Storage deletion is not transactionally coupled to PostgreSQL. Record a
    cleanup job instead of pretending both systems committed atomically.
12. Invitations and visitor sessions store hashes, never plaintext tokens.
13. Family cookies remain HttpOnly, SameSite=Lax, and Secure in production.
14. Parent notes are never included in AI input.
15. AI output remains pending until a version-checked explicit review.
16. Backup output excludes token/session hashes, signed URLs, and credentials.
17. Permanent deletion requires confirmation and preserves the Auth account.
18. Sensitive responses use `no-store`.

## 9. Authentication details

Authentication uses Supabase SSR PKCE cookies.

- Browser config must access `NEXT_PUBLIC_SUPABASE_URL` through explicit static
  `process.env.NEXT_PUBLIC_*` references; dynamic `process.env` lookup is not
  inlined into browser bundles.
- Browser, server, and middleware clients share
  `SUPABASE_AUTH_STORAGE_KEY`.
- Redirects must preserve the request host. Use
  `src/lib/request-origin.ts`; do not reconstruct redirects from a different
  `localhost`/`127.0.0.1` origin.
- Local callbacks for ports 3000 and 3100 are registered in
  `supabase/config.toml`.
- Magic Link messages are one-time. Old Mailpit messages cannot be reused.

The full login path is covered by `tests/e2e/supabase.login.spec.ts`.

## 10. Local development

### First setup

```powershell
Set-Location C:\Users\zhaojian\Downloads\GH_Projects\ai_ideas\kids-museum
npm.cmd install
npm.cmd run local:bootstrap
npm.cmd run docker:up
```

`local:bootstrap`:

- starts Supabase;
- applies all migrations;
- creates ignored `.env.local`;
- creates synthetic local curator data;
- does not send email or AI content outside the machine.

The fixed local curator email is `curator@kids-museum.local`. See `README.md`
and `tools/setup-local-resources.mjs` for local-only credentials. Magic Link
mail appears in Mailpit.

### Runtime commands

```powershell
npm.cmd run docker:up
npm.cmd run docker:logs
npm.cmd run docker:down
npm.cmd run supabase:status
npm.cmd run supabase:reset
npm.cmd run cleanup:media
```

If PowerShell cannot find `docker` immediately after installation, restart the
terminal or add `C:\Program Files\Docker\Docker\resources\bin` to `PATH`.

## 11. Validation and definition of done

Run:

```powershell
npm.cmd run verify
```

It covers:

- ESLint;
- TypeScript;
- 19 unit-test files;
- real Supabase integration tests;
- isolated preview E2E;
- Supabase Magic Link and invitation E2E;
- production standalone build.

Useful individual commands:

```powershell
npm.cmd run test:unit
npm.cmd run test:integration
npm.cmd run e2e:preview
npm.cmd run e2e:supabase
npm.cmd run build
```

A change is not done when only unit tests pass. Database/RLS/Storage/Auth
changes require local Supabase integration tests. User journey changes require
Playwright coverage.

CI runs validation on Windows and Ubuntu, preview E2E, and Docker-backed
Supabase tests via `.github/workflows/ci.yml`.

## 12. Coding conventions

- Use strict TypeScript. Avoid `any` and unsafe casts.
- Validate request bodies, provider output, and JSON database fields.
- Keep browser/server/admin Supabase clients separate.
- Mark service-only modules with `server-only`.
- Put multi-row invariants in SQL RPCs/triggers and retain RLS as defense in
  depth.
- Use append-only migrations.
- Do not swallow Supabase `{ error }` results; most SDK errors are returned, not
  thrown.
- Expose explicit failure/warning states for partial media cleanup.
- Use the existing design tokens and `--cp-*` colors. Do not hardcode a new
  unrelated palette.
- Preserve mobile-first curator forms and accessible visitor controls.
- Dynamic Next.js route params are promises; use `await context.params`.
- Read the Next.js repository docs referenced in the generated block above
  before relying on old framework behavior.

## 13. Historical regressions to avoid

These failures occurred during implementation and explain some non-obvious
code:

- Dynamic `process.env` lookup in browser code made Supabase appear
  unconfigured.
- Different public/internal Supabase URLs generated different PKCE cookie keys.
- Switching between `localhost` and `127.0.0.1` lost auth/visitor cookies.
- Reusing an old Magic Link produced “One-time token not found.”
- Storage policies using unqualified `name` resolved to
  `museum_profiles.name`; use `storage.objects.name`.
- RLS without role-level GRANT caused service-role PostgREST 403 responses.
- Client-callable asset RPCs allowed validation bypass; formal asset commit is
  service-role only.
- Concurrent or repeated AI review could overwrite newer content; reviews now
  lock and compare versions.
- Offset pagination could drift during backup; backup now uses one database
  snapshot RPC.
- Deleting DB rows before tracking Storage paths created orphans; use cleanup
  jobs and upload-session recovery.
- Vercel-sized request bodies cannot carry base64 media; keep signed direct
  upload.
- Windows `spawnSync("npm.cmd")` is unreliable in some Node versions; the
  scripts use `process.execPath + npm_execpath`.
- Supabase runtime files under `supabase/.temp` must stay outside lint scope.

## 14. Safe extension recipes

### Add an artwork field

1. Add an append-only migration and constraints.
2. Update artwork Zod contracts.
3. Update create/update RPCs.
4. Update server mapping, curator form, exhibition mapping, and backup snapshot.
5. Add unit and Supabase integration tests.

### Add an AI suggestion type

1. Extend the database type/check constraint.
2. Extend provider prompt and Zod output validation.
3. Persist a pending suggestion with the current input version.
4. Apply it in the locking review RPC.
5. Write an audit event.
6. Add stale/repeat-review tests.

### Add a media kind

1. Extend database enum/checks and private bucket MIME allowlist.
2. Extend temp-path and final-path validation.
3. Add browser sanitization and server byte inspection.
4. Add upload-session descriptors and cleanup handling.
5. Add backup/export support and integration tests.

### Change publication rules

Update both TypeScript preview validation and the database save/publish RPC.
They must reject the same invalid state.

## 15. Current handoff state and next opportunities

At the time of this document:

- all 21 tracked implementation tasks are complete;
- local Supabase, web, and AI mock containers are deployed and healthy;
- real RLS/Storage/RPC integration tests pass;
- preview, invitation, and Magic Link browser flows are covered;
- the working tree contains a large feature implementation that must not be
  reset or replaced casually.

Recommended next work:

1. Implement backup import/restore with dry-run validation.
2. Schedule the media cleanup worker instead of relying only on CLI/request
   processing.
3. Replace in-memory AI rate limiting with shared persistent limiting.
4. Add cloud deployment records and production smoke tests.
5. Generate Supabase database types and replace remaining hand-written result
   shapes.
6. Expand visitor session management and audit views.
7. Add handmade-work step/video modeling without weakening the private media
   boundary.

## 16. Before handing off again

Record:

- the exact task and intended behavior;
- migrations added;
- security invariants affected;
- commands run and results;
- any skipped Docker/cloud checks;
- files with intentionally unresolved changes;
- the next concrete action.

Never claim deployment or private-data migration succeeded unless the real
target environment was exercised.
