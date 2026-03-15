---
name: openclaw-jianai-control
description: Use this skill when an external agent such as OpenClaw needs to control a running JianAI desktop app over the local HTTP control API, including checking service health, reading status, and sending editing commands to the in-app Agent such as adding titles or subtitle-like text overlays.
---

# OpenClaw JianAI Control

Use this skill when the user wants to drive the running JianAI app from outside the UI.

## Preconditions

- JianAI must already be running.
- The app should already be inside the video editor for the target project.
- The local control service listens on `127.0.0.1:47821`.
- Auth token is stored in `renderer_settings.json` under `externalControl.token`.

Windows default token file:

`C:\Users\<username>\AppData\Local\JianAI\renderer_settings.json`

## Workflow

1. Read `renderer_settings.json` and extract:
   - `externalControl.enabled`
   - `externalControl.port`
   - `externalControl.token`
2. Call `GET /health`.
3. Call `GET /status` with the token.
4. Send `POST /agent/chat` with JSON body:

```json
{
  "input": "list clips"
}
```

5. Return the JSON result directly and summarize:
   - whether the call succeeded
   - provider used (`llm` or `rule`)
   - action count
   - assistant text

## Auth

Use either:

- `Authorization: Bearer <token>`
- `X-JianAI-Token: <token>`

## Endpoints

- `GET /health`
- `GET /status`
- `POST /agent/chat`

## PowerShell examples

Read token:

```powershell
$token = (Get-Content 'C:\Users\Administrator\AppData\Local\JianAI\renderer_settings.json' | ConvertFrom-Json).externalControl.token
```

Health:

```powershell
Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:47821/health'
```

Status:

```powershell
Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:47821/status' -Headers @{ Authorization = "Bearer $token" }
```

Send command:

```powershell
$body = @{ input = 'move the first clip forward by 1 second' } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:47821/agent/chat' -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
```

## Constraints

- First version only controls the currently open editor window.
- It does not open projects automatically.
- It does not run headless.
- If the LLM endpoint is unavailable, JianAI may fall back to the local rule engine.

## Good first commands

- `list clips`
- `list assets`
- `add title External API test at 1 second`
- `add subtitle Hello from OpenClaw at 2 seconds`
- `move the first clip forward by 1 second`
- `delete the last clip`

## Notes from live test

- `add subtitle ...` is accepted by `/agent/chat` and returns success.
- In the current JianAI behavior, the assistant reply indicates it may implement subtitle requests as a title/text overlay element (for example: “已添加标题 …”). Treat subtitle insertion as subtitle-like on-screen text unless the app later exposes a distinct subtitle track action.
