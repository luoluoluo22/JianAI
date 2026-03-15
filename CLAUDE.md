# CLAUDE.md

This file provides guidance when working with this repository.

## Project Overview

**剪艾 JianAI** is an Electron desktop app for **AI-assisted video editing**. The core focus is on AI-driven timeline manipulation through natural language, not video generation.

Three-layer architecture:

- **Frontend** (`frontend/`): React 18 + TypeScript + Tailwind CSS editor UI
- **Electron** (`electron/`): Main process managing app lifecycle, IPC, file system, backend process lifecycle
- **Backend** (`backend/`): Python FastAPI server (port 8000) handling Agent execution, timeline state management, and media processing

### Current Product Focus

- ✅ AI conversational editing (Timeline Agent reads state → executes structured actions)
- ✅ Timeline state-driven UI (JSON data model → React re-renders)
- ✅ Local desktop editor experience (no cloud dependency)
- ✅ Extensible Agent execution framework (OpenAI-compatible API support)

### Not Current Priorities

- ❌ Text-to-video generation
- ❌ Image-to-video generation
- ❌ Image generation
- ❌ Local LLM inference workflows

## Common Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start dev server (Vite + Electron + Python backend) |
| `pnpm dev:debug` | Dev with Electron inspector + Python debugpy |
| `pnpm typecheck` | Run TypeScript (`tsc --noEmit`) and Python (`pyright`) type checks |
| `pnpm typecheck:ts` | TypeScript only |
| `pnpm typecheck:py` | Python pyright only |
| `pnpm backend:test` | Run Python pytest tests |
| `pnpm build:frontend` | Vite frontend build only |
| `pnpm build` | Full platform build (auto-detects platform) |
| `pnpm setup:dev` | One-time dev environment setup (auto-detects platform) |

Run a single backend test file: `pnpm backend:test -- tests/test_file.py`

## CI Checks

PRs must pass: `pnpm typecheck` + `pnpm backend:test` + frontend Vite build.

## Frontend Architecture

- **Path alias**: `@/*` maps to `frontend/*`
- **State management**: React contexts only (`ProjectContext`, `AppSettingsContext`, `KeyboardShortcutsContext`) — no Redux/Zustand
- **Routing**: View-based via `ProjectContext` with views: `home`, `project`, `playground`
- **Timeline UI**: `frontend/views/VideoEditor.tsx` (largest component) manages track rendering and playback
- **IPC bridge**: All Electron communication through `window.electronAPI` (defined in `electron/preload.ts`)
- **Backend calls**: Always use `backendFetch` from `frontend/lib/backend.ts` for backend HTTP requests. Do not call `fetch` directly.
- **Styling**: Tailwind with custom semantic color tokens via CSS variables; utilities from `class-variance-authority` + `clsx` + `tailwind-merge`
- **Project state**: Stored in `frontend/types/project.ts` — tracks, clips, timeline, media metadata
- **Agent Panel**: Right-side conversational UI for issuing timeline edit commands

## Backend Architecture

Request flow: `_routes/* (thin) → AppHandler → handlers/* (logic) → services/* (side effects) + state/* (mutations)`

Key patterns:
- **Routes** (`_routes/`): Thin plumbing only — parse input, call handler, return typed output. No business logic.
- **AppHandler** (`app_handler.py`): Single composition root owning all sub-handlers, state, and lock
- **State** (`state/`): Centralized `AppState` using discriminated union types for state machines
- **Services** (`services/`): Protocol interfaces with real + fake test implementations. The test boundary for heavy side effects.
- **Concurrency**: Thread pool with shared `RLock`. Pattern: lock→read/validate→unlock→heavy work→lock→write. Never hold lock during heavy compute/IO.
- **Exception handling**: Boundary-owned traceback policy via `app_factory.py`

### Agent Execution Flow

Timeline Agent endpoint (`_routes/generation.py` or similar) typically:
1. Receives user natural language + current timeline state
2. Calls LLM (OpenAI-compatible API) with structured prompt
3. Parses LLM output into `TimelineAction` objects (move, trim, add transition, etc.)
4. Applies actions to timeline state under lock
5. Returns new state + execution log to frontend
6. Frontend re-renders based on new state

### Backend Testing

- Integration-first using Starlette `TestClient` against real FastAPI app
- **No mocks**: `test_no_mock_usage.py` enforces no `unittest.mock`. Swap services via `ServiceBundle` fakes only.
- Fakes live in `tests/fakes/`; `conftest.py` wires fresh `AppHandler` per test
- Pyright strict mode enforced as a test (`test_pyright.py`)

### Adding a Backend Feature (Timeline Editing)

1. Define request/response models in `api_types.py`
2. Add endpoint in `_routes/` delegating to handler
3. Implement logic in `handlers/` with lock-aware state transitions
4. If new side effect needed, add service in `services/` with Protocol + real + fake
5. Add integration test in `tests/` using fake services

## TypeScript Config

- Strict mode with `noUnusedLocals`, `noUnusedParameters`
- Frontend: ES2020 target, React JSX
- Electron main process: ESNext, compiled to `dist-electron/`
- Preload script: CommonJS

## Python Config

- Python 3.12+ managed with `uv`
- Pyright strict mode (`backend/pyrightconfig.json`)
- Dependencies in `backend/pyproject.toml`

## Key File Locations

- Backend architecture: `backend/architecture.md`
- App settings schema: `settings.json`
- Electron builder config: `electron-builder.yml`
- Video editor: `frontend/views/VideoEditor.tsx`
- Project types: `frontend/types/project.ts`
- Timeline executor/actions: Look in `handlers/` and `api_types.py` for action definitions