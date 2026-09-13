# OmniStudio

Desktop workstation for local LLMs — manage models, run inference servers (llama.cpp / vLLM / SGLang / MLX), and use Chat / Agent / Voice / Image / Video / OCR / Translate apps, with a local knowledge base, shared memory, and Skills management. Built with Electrobun (NOT Electron — do not use Electron APIs).

Architecture overview for maintainers: [docs/architecture.md](./docs/architecture.md). Planning and open work: [ROADMAP.md](./ROADMAP.md).

## Stack

- **Desktop:** Electrobun + Bun
- **Frontend:** React 19, Tailwind, shadcn/ui, Zustand, TanStack Query
- **AI:** `@earendil-works/pi-agent-core` + `pi-ai` drive the agent loop; Vercel AI SDK (`ai`) + `@ai-sdk/openai-compatible` for OCR/translation one-shot calls
- **DB:** Drizzle ORM + SQLite (WAL)
- **Build:** Vite, Turborepo, Bun workspaces

## Structure

```
apps/
├── studio/               # Electrobun desktop app
│   ├── bin/omi.ts        # CLI entry
│   └── src/
│       ├── bun/          # Main process (RPC, DB, runtimes, agent, media pipelines, servers)
│       ├── shared/       # Shared by BOTH main process and webview (no electrobun imports)
│       ├── cli/          # omi CLI (standalone process)
│       └── mainview/     # React UI (app/, components/, stores/, lib/)
└── landing/              # Marketing site (kunpengtalk.com)
```

## Electrobun

Full API reference: https://blackboard.sh/electrobun/llms.txt
Getting started: https://blackboard.sh/electrobun/docs/

Import patterns:

- Main process (Bun): `import { BrowserWindow } from "electrobun/bun"`
- Browser context: `import { Electroview } from "electrobun/view"`

Use `views://` URLs to load bundled assets (e.g., `url: "views://mainview/index.html"`).
Views must be configured in `electrobun.config.ts` to be built and copied into the bundle.

## Key Patterns

- RPC via `BrowserView.defineRPC` for main ↔ webview communication; the contract type
  `AppRPC` lives in `src/bun/rpc/index.ts` and is shared with the webview
- Document pipeline: upload → PDF/image → Sharp → VLM OCR → HTML → Markdown
- Settings and documents stored in SQLite via Drizzle
- Image regions cropped from source using bounding boxes, stored as WebP
- Streaming pushes are throttled (chat 40ms, download progress 400ms, logs 80ms) because
  every event re-renders the webview — flush before emitting a terminal event
- All media (chat images, generated images, OCR page images, TTS/ASR audio, artifact and
  workspace previews) is served by the image server on a **fixed** loopback port
  (`imageServerPort()`, 127.0.0.1:19782). The webview cannot read the main process env, so
  every process must keep using that constant — a per-instance port would silently produce
  URLs pointing at nothing. When the port is taken, `startImageServer()` probes the holder's
  identity (`/__omni/media-id`) instead of degrading silently: same data dir = shared
  (harmless), different data dir = blocked (previews would hit someone else's files). The
  state goes to the top bar, and binding is retried every 5s so the app takes over once the
  other instance quits
- **Every subsystem failure goes to one log**: `src/bun/app-log.ts` writes event-level records
  (JSONL, `<dataDir>/logs/app.log`, 2MB rotation, secrets redacted) for image / video / TTS /
  ASR / OCR, the inference server, downloads, the gateway, the Agent and webview-side errors.
  Read it with `omi logs` (falls back to the file when the app is down — crash triage),
  the control socket `logs` command, or RPC `getAppLogs`. Inference server stdout/stderr is
  deliberately **not** in there (per-instance 200k in-memory buffer, `omi server logs`).
  A failure path without a `logEvent` call is a bug: the next person cannot diagnose it.
  Full triage guide: `.agents/skills/omni-doctor/`; one-shot evidence dump:
  `bun run --cwd apps/studio scripts/omni-diag.ts`
- **Cloud models are picked as `provider → model`, never as a per-page URL + key**: image,
  image-edit, video, TTS, ASR, live-translate and VLM OCR each store only a provider id
  (`IMG_PROVIDER_ID` / `TTS_PROVIDER_ID` / …) plus a model name; base URL and key come from
  the `cloud_providers` row (`resolveCloudProvider`). Providers are *enabled* individually
  (several at once — `enabled` column) and enabling runs a `/v1/models` key check, so a
  page never has to ask for credentials again. Each model entry carries a **purpose**
  (`CloudModelEntry.type`: image / video / tts / asr / chat / …; inferred from the id when
  absent) and every picker filters by it — a new cloud model selector must go through
  `CloudModelSelect` + `providersForType` instead of listing all providers.
  Video is the exception that proves the rule: video APIs are not standardized, so the
  provider row also carries `videoApi` ("minimax" | "seedance") and polling looks the
  submitter up by the record's `providerId`.

## Hard Rules

- `src/shared/*` is imported by both processes — never import `electrobun` there.
- `src/bun/paths.ts` and `src/bun/db/index.ts` must NOT import `electrobun/bun` at module
  scope (it starts a dev server + reads version.json as a side effect); they compute
  userData themselves via `getUserDataDir()`.
- Python helper scripts (`mlx-worker.py`, `mlx-model.py`, `ppocr-worker.py`) are spawned via
  `import.meta.dir` relative paths, so they must stay listed in `electrobun.config.ts`'s
  `build.copy`. Missing them exits Python with code 2 and surfaces as bogus model download failures.
- Child processes are spawned `detached` and killed by process group (`kill(-pid)`) — killing
  only the direct child leaves VRAM-hogging orphans behind.
- Anything that resolves a user-supplied path (downloads, media, Skills deletes) must validate
  it against the data directory — inputs arrive from the webview and the control socket.
- Adding an inference engine means editing `src/shared/engines.ts` plus one `Runtime`
  implementation; do not hardcode engine checks elsewhere.
- `src/bun/backup/*` must not import `db/index.ts` or `electrobun` — that isolation is what
  lets `omi backup` work when the app won't start (migrations failed). Entry points that
  need the data layer belong in `src/cli/commands/backup.ts`, not in the kernel.
- Backup archives are untrusted input on restore: every extracted path goes through
  `path-safety` against the resolved root.

## CLI (`omi`)

- `apps/studio/bin/omi.ts` + `src/cli/*` is a standalone Bun CLI that talks to the
  running app over a Unix socket (`<dataDir>/omni-control.sock`, served by
  `src/bun/control-server.ts`). Commands: `start/stop/restart/serve/launch/memory/backup/model/
  cloud/models/model-info/status/server/logs/install/guide/version/update`.
  Data-dir resolution (`src/cli/data-dir.ts`) pings every channel's control socket and talks to
  whichever instance actually answers (dev/canary builds run from source or `build/` count too);
  only when nothing is running does it fall back to the most recently used channel. Checking a
  socket *file* is not enough — crashed instances leave them behind.
- When the app is not running, read-only data access falls back to direct
  SQLite imports (`src/cli/db.ts`) — it sets `OMNI_DATA_DIR`/`OMNI_DB_PATH` first.
- Install once with `cd apps/studio && bun link` to expose the `omi` command.
- CLI docs are data-driven: `src/shared/cli-docs.ts` feeds `omi guide`, `docs/omi-cli.md`,
  and the in-app Settings → Tools → Command line page. Regenerate the doc with
  `bun run scripts/omi-docs-smoke.ts --write`; the same script verifies sync.
- A legacy second CLI (`src/cli/omni.ts`, commands `chat`/`doctor`/`config`/`gateway`)
  still exists alongside `omi`; new work goes into `omi` only.

## Checks

Run what CI runs before committing:

```bash
bun run lint && bun run typecheck && bun run test
bun run --cwd apps/studio test:smoke
```
