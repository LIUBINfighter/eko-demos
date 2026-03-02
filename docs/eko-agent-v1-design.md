# eko-agent V1 Design

## 1. Scope

V1 upgrades `browser-extension-quickstart` from a single-run demo to a minimal task-oriented agent runtime.

Primary goals:
- Task state machine with explicit lifecycle (`created/running/blocked/paused/succeeded/failed`)
- Plan-execute-verify loop foundation
- Minimal role split (`Conductor`, `BrowserWorker`, `Verifier`) in runtime structure
- Failure recovery hooks (`retry`, `replan`, `human-interrupt`) as interfaces
- Observability timeline for each task

Out of scope for V1:
- Large multi-agent swarms
- Cross-device distributed scheduling
- Long-term memory system
- Fully autonomous high-risk operations

## 2. Current Gap Summary

`quickstart` today:
- Starts one run directly from sidebar message
- Streams logs only, no task-level governance
- Stops by aborting running Eko task IDs, no lifecycle control

`eko-core` already provides:
- Planning and workflow execution
- Tool-loop execution and replanning capabilities
- Task abort and callback events

Gap to close in V1:
- Productized orchestration shell around `eko-core`
- Task lifecycle + validation + recovery + telemetry

## 3. Target Architecture (V1)

Components:
- `TaskStateMachine` (pure logic)
  - Valid transitions and event application
  - Terminal state checks and transition safety
- `TaskManager` (runtime orchestration)
  - Create/start/stop task
  - Owns current running execution handle
  - Emits task timeline events
- `EkoExecutionAdapter`
  - Wraps `main.ts` run behavior into a stable handle:
    - `completion` promise
    - `abort()` method
- `BackgroundController`
  - Receives Chrome messages (`run`, `stop`)
  - Uses TaskManager and forwards timeline updates to UI
- `Sidebar`
  - Displays task status + taskId + timeline logs

## 4. State Machine

States:
- `created`
- `running`
- `blocked`
- `paused`
- `succeeded`
- `failed`

Events:
- `start`
- `block`
- `resume`
- `pause`
- `succeed`
- `fail`

Transition matrix:
- `created` -> `running`
- `running` -> `blocked|paused|succeeded|failed`
- `blocked` -> `running|paused|failed`
- `paused` -> `running|failed`
- `succeeded` -> terminal
- `failed` -> terminal

Illegal transitions throw explicit errors.

## 5. Event Protocol (Background -> Sidebar)

Message types:
- `task_update`
  - payload: `{ task }`
- `log`
  - existing stream and non-stream logs
- `stop`
  - existing run/stop compatibility signal

`task` shape:
- `id: string`
- `prompt: string`
- `state: TaskState`
- `createdAt: string`
- `updatedAt: string`
- `attempt: number`
- `result?: string`
- `error?: string`

## 6. Recovery Strategy (V1 foundation)

Initial V1 behavior:
- `retry`: interface reserved in manager, default no auto-retry yet
- `replan`: reserved hook point in execution adapter
- `human-interrupt`: mapped to `blocked` state with reason

This ships the control plane first; richer policies follow in V1.1.

## 7. Security Baseline

Current quickstart reads API key from extension storage. V1 keeps compatibility but introduces abstraction boundary:
- `LLMConfigProvider` interface in `main.ts`
- Enables later migration to local proxy/backend token flow without refactoring task runtime

## 8. Metrics for Acceptance

V1 acceptance metrics:
- 100% tasks have valid lifecycle transitions (no silent state jumps)
- Stop action always transitions task to `paused` or terminal state
- Every task emits at least one `task_update` event per state change
- Build and tests pass in CI/local

Operational metrics (target):
- Task success rate on top scenarios >= 70%
- Human interventions <= 1.5 per task

## 9. Delivery Plan

Week 1:
- Task state machine + tests
- Task manager + tests
- Background integration with lifecycle events

Week 2:
- Verifier hook and task result normalization
- Sidebar task status rendering
- Error classification and improved timeline

Week 3-4:
- Retry/replan policy implementation
- Model routing/fallback policy abstraction
- Security migration prep for key handling

