# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LTX Desktop is an Electron app for AI video generation using LTX models. Three-layer architecture:

- **Frontend** (`frontend/`): React 18 + TypeScript + Tailwind CSS renderer
- **Electron** (`electron/`): Main process managing app lifecycle, IPC, Python backend process, ffmpeg export
- **Backend** (`backend/`): Python FastAPI server (port 8000) handling ML model orchestration and generation

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

Run a single backend test file via pnpm: `pnpm backend:test -- tests/test_ic_lora.py`

## CI Checks

PRs must pass: `pnpm typecheck` + `pnpm backend:test` + frontend Vite build.

## Frontend Architecture

- **Path alias**: `@/*` maps to `frontend/*`
- **State management**: React contexts only (`ProjectContext`, `AppSettingsContext`, `KeyboardShortcutsContext`) — no Redux/Zustand
- **Routing**: View-based via `ProjectContext` with views: `home`, `project`, `playground`
- **IPC bridge**: All Electron communication through `window.electronAPI` (defined in `electron/preload.ts`)
- **Backend calls**: Always use `backendFetch` from `frontend/lib/backend.ts` for app backend HTTP requests (it attaches auth/session details). Do not call `fetch` directly for backend endpoints.
- **Styling**: Tailwind with custom semantic color tokens via CSS variables; utilities from `class-variance-authority` + `clsx` + `tailwind-merge`
- **No frontend tests** currently exist

## Backend Architecture

Request flow: `_routes/* (thin) → AppHandler → handlers/* (logic) → services/* (side effects) + state/* (mutations)`

Key patterns:
- **Routes** (`_routes/`): Thin plumbing only — parse input, call handler, return typed output. No business logic.
- **AppHandler** (`app_handler.py`): Single composition root owning all sub-handlers, state, and lock
- **State** (`state/`): Centralized `AppState` using discriminated union types for state machines (e.g., `GenerationState = GenerationRunning | GenerationComplete | GenerationError | GenerationCancelled`)
- **Services** (`services/`): Protocol interfaces with real implementations and fake test implementations. The test boundary for heavy side effects (GPU, network).
- **Concurrency**: Thread pool with shared `RLock`. Pattern: lock→read/validate→unlock→heavy work→lock→write. Never hold lock during heavy compute/IO.
- **Exception handling**: Boundary-owned traceback policy. Handlers raise `HTTPError` with `from exc` chaining; `app_factory.py` owns logging. Don't `logger.exception()` then rethrow.
- **Naming**: `*Payload` for DTOs/TypedDicts, `*Like` for structural wrappers, `Fake*` for test implementations

### Backend Testing

- Integration-first using Starlette `TestClient` against real FastAPI app
- **No mocks**: `test_no_mock_usage.py` enforces no `unittest.mock`. Swap services via `ServiceBundle` fakes only.
- Fakes live in `tests/fakes/`; `conftest.py` wires fresh `AppHandler` per test
- Pyright strict mode is also enforced as a test (`test_pyright.py`)

### Adding a Backend Feature

1. Define request/response models in `api_types.py`
2. Add endpoint in `_routes/<domain>.py` delegating to handler
3. Implement logic in `handlers/<domain>_handler.py` with lock-aware state transitions
4. If new heavy side effect needed, add service in `services/` with Protocol + real + fake implementations
5. Add integration test in `tests/` using fake services

## TypeScript Config

- Strict mode with `noUnusedLocals`, `noUnusedParameters`
- Frontend: ES2020 target, React JSX
- Electron main process: ESNext, compiled to `dist-electron/`
- Preload script must be CommonJS

## Python Config

- Python 3.13+ (per `.python-version`), managed with `uv`
- Pyright strict mode (`backend/pyrightconfig.json`)
- Dependencies in `backend/pyproject.toml`

## Key File Locations

- Backend architecture doc: `backend/architecture.md`
- Default app settings schema: `settings.json`
- Electron builder config: `electron-builder.yml`
- Video editor (largest frontend file): `frontend/views/VideoEditor.tsx`
- Project types: `frontend/types/project.ts`

# Timeline Agent Guide

## Overview

The **Timeline Agent** is the conversational interface for AI-assisted video editing in JianAI. It allows users to issue natural language commands that are converted into structured timeline actions.

## Architecture

```
User Natural Language
        ↓
[Agent Panel - frontend/components/AgentPanel.tsx]
        ↓
[Timeline Agent Endpoint - backend/_routes/]
        ↓
[LLM Call] (OpenAI-compatible API)
        ↓
[Parse LLM Output] → TimelineAction[] (structured JSON)
        ↓
[Execute Actions] under lock
        ↓
[Update AppState] with new timeline
        ↓
[Return] new state + execution log
        ↓
[Frontend Re-renders] based on new state
```

## Typical User Interactions

- "把第一张图片放到最后一个片段之后" (Move first image after last clip)
- "把选中的片段后移2秒" (Shift selected clip 2s forward)
- "给第一个片段加0.5秒淡入" (Add 0.5s fade-in to first clip)
- "在5秒添加标题 欢迎来到片场" (Add title at 5s mark)

## Frontend Side (Agent Panel)

**File**: `frontend/components/AgentPanel.tsx` or similar

Responsibilities:
- Display conversation history
- Accept user text input
- Allow users to reference selected materials/clips in the message
- Send request to backend with current timeline state + message
- Display Agent response and execution log
- Show debug logs if enabled

Key props/state:
- Current timeline state (from `ProjectContext`)
- Current selection (tracks, clips, media)
- Backend endpoint: typically `/agent/chat` or `/generation/...`
- LLM settings (API endpoint, model, API key)

## Backend Side (Agent Handler)

**Main file pattern**: `backend/handlers/agent_handler.py` or `backend/_routes/generation.py`

High-level steps:

1. **Receive request**
   - User message (string)
   - Current timeline state (JSON)
   - Optional selected media/clips

2. **Format prompt for LLM**
   - Inject timeline state as context
   - Include schema for expected action responses
   - Add few-shot examples if needed

3. **Call LLM** (OpenAI-compatible)
   ```python
   response = await openai_client.chat.completions.create(
       model=model_name,
       messages=[{"role": "user", "content": prompt}],
       temperature=0.7,
       response_format={"type": "json_object"}  # enforce JSON
   )
   ```

4. **Parse LLM response into actions**
   - Extract `TimelineAction` objects from JSON
   - Each action has: `type` (move, trim, add_transition, etc.), `target_id`, `params`
   - Validate action schema against `TimelineAction` Pydantic model

5. **Execute actions under lock**
   - Acquire shared lock in `AppHandler`
   - Read current timeline from `AppState`
   - Apply each action sequentially (may have dependencies)
   - Update `AppState.timeline` with results

6. **Return response**
   - New timeline state (for frontend to re-render)
   - Execution log (which actions succeeded/failed)
   - Debug info (LLM response, prompt, token count, etc.)

## Supported Timeline Actions

Common action types (defined in `backend/api_types.py`):

| Action | Params | Purpose |
|---|---|---|
| `move_clip` | `clip_id`, `new_start_time`, `track_id` | Reposition clip on timeline |
| `trim_clip` | `clip_id`, `new_duration`, `trim_side` | Adjust clip duration |
| `add_transition` | `clip_id`, `transition_type`, `duration` | Add fade/dissolve between clips |
| `set_clip_speed` | `clip_id`, `speed_factor` | Speed up/slow down playback |
| `add_clip_effect` | `clip_id`, `effect_name`, `params` | Apply effects (fade-in, fade-out, etc.) |
| `add_title` | `start_time`, `duration`, `text`, `style` | Insert title/text overlay |
| `delete_clip` | `clip_id` | Remove clip from timeline |
| `duplicate_clip` | `clip_id`, `new_start_time` | Clone clip |

## Extending the Agent

### 1. Add a new action type

In `backend/api_types.py`:

```python
class MoveClipAction(BaseModel):
    type: Literal["move_clip"]
    clip_id: str
    new_start_time: float
    track_id: int

# Add to discriminated union:
TimelineAction = MoveClipAction | TrimClipAction | AddTransitionAction | ...
```

### 2. Implement the action executor

In `backend/handlers/timeline_handler.py` or similar:

```python
def execute_move_clip(
    state: AppState,
    action: MoveClipAction
) -> tuple[AppState, str]:
    """Apply move_clip action and return (new_state, log_message)."""
    # Find clip, validate timing, update state
    # Return updated AppState and execution message
    pass
```

### 3. Update the LLM prompt

In the agent endpoint, include the new action in the schema:

```python
schema = {
    "actions": [
        {
            "type": "move_clip",
            "clip_id": "...",
            "new_start_time": 5.0,
            "track_id": 0
        },
        # ... more actions
    ]
}
```

### 4. Add a test

In `backend/tests/test_agent.py`:

```python
def test_move_clip_action():
    # Create timeline with test clips
    # Call agent endpoint with "move first clip to 10s"
    # Assert response state reflects the move
    pass
```

## Concurrency & State Locking

The Agent handler must respect the shared lock:

```python
def agent_chat(message: str, timeline: Timeline, handler: AppHandler) -> Response:
    with handler.state_lock:
        # Read current state
        current_state = handler.state
        
        # Plan actions (don't mutate yet)
        actions = parse_llm_output(llm_response)
    
    # Heavy work (LLM call) happens WITHOUT lock
    # ...
    
    with handler.state_lock:
        # Re-check state is still compatible
        # Apply actions
        new_state = execute_actions(handler.state, actions)
        handler.state = new_state
    
    return new_state
```

## LLM Configuration

Users configure LLM via agent settings panel. Backend needs:

- **API Endpoint**: `https://api.openai.com/v1` (or compatible)
- **Model Name**: `gpt-4`, `claude-opus`, etc.
- **API Key**: User-provided secret

Store in `AppState.agent_config` or similar, load into handler at runtime.

## Debugging

- **Frontend logs**: Check browser console for request/response JSON
- **Backend logs**: Check Python backend logs for LLM prompt, response, and action execution
- **Debug panel**: Agent panel can display execution log and intermediate JSON
- **Persistent logs**: Backend writes `jsonl` debug logs to app data directory

## Error Handling

Common error scenarios:

1. **LLM returns invalid JSON** → Log error, return "Could not understand response"
2. **Action references non-existent clip** → Validate clip_id exists, skip invalid action
3. **Action violates timeline constraints** (e.g., overlap) → Reject with reason
4. **Concurrent state change** (state changed between read and write) → Re-validate, return conflict

All errors should be logged with full traceback in backend; frontend shows user-friendly summary.

## Testing the Agent

### Unit test pattern (fake LLM)

```python
def test_agent_with_fake_llm():
    fake_llm = FakeLLM(responses=[
        {"actions": [{"type": "move_clip", "clip_id": "c1", "new_start_time": 10}]}
    ])
    handler = build_app_handler(service_bundle=ServiceBundle(llm=fake_llm))
    
    response = client.post("/agent/chat", json={
        "message": "move first clip",
        "timeline": sample_timeline()
    })
    
    assert response.status_code == 200
    assert response.json()["timeline"]["clips"][0]["start_time"] == 10
```

### Integration test pattern (real endpoint)

```python
def test_agent_integration(test_client, handler):
    response = test_client.post("/agent/chat", json={
        "message": "move first clip to 5 seconds",
        "timeline": sample_timeline()
    })
    
    assert response.status_code == 200
    data = response.json()
    assert len(data["execution_log"]) > 0
    assert data["success"] == True
```

## References

- Backend architecture: `backend/architecture.md`
- Timeline types: `backend/api_types.py` (TimelineAction, Clip, Track, etc.)
- Agent handler implementation: `backend/handlers/`
- Frontend panel: `frontend/components/AgentPanel.tsx` or similar
