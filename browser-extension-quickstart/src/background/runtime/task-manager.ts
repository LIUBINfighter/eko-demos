import {
  applyTaskEvent,
  createTask,
  finishTaskStep,
  isTerminalTask,
  setTaskPhase,
  startTaskStep,
  TaskPhase,
  TaskRecord,
} from "./task-state-machine";
import {
  DefaultTaskVerifier,
  TaskVerifier,
  VerificationDecision,
} from "./task-verifier";

export interface ExecutionOutcome {
  success: boolean;
  result?: string;
  error?: string;
}

export interface ExecutionHandle {
  completion: Promise<ExecutionOutcome>;
  abort: () => void;
}

export interface ExecutionRuntimeHooks {
  onPhase: (phase: TaskPhase, detail?: string) => void;
  onStepStart: (stepName: string, detail?: string) => void;
  onStepEnd: (stepName: string, detail?: string) => void;
  onEvent: (
    name: string,
    detail?: string,
    data?: Record<string, unknown>
  ) => void;
}

export type ExecutionRunner = (
  task: TaskRecord,
  hooks: ExecutionRuntimeHooks
) => Promise<ExecutionHandle> | ExecutionHandle;

export type TaskUpdateListener = (task: TaskRecord) => void;

export type TaskTimelineEventType =
  | "task_created"
  | "state_changed"
  | "phase_changed"
  | "step_started"
  | "step_finished"
  | "runtime_event"
  | "execution_succeeded"
  | "execution_failed"
  | "verifier_approved"
  | "verifier_retry"
  | "verifier_blocked"
  | "verifier_failed"
  | "task_paused";

export interface TaskTimelineEvent {
  id: string;
  taskId: string;
  type: TaskTimelineEventType;
  at: string;
  detail?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

export type TaskEventListener = (
  event: TaskTimelineEvent,
  task: TaskRecord
) => void;

export interface TaskManagerConfig {
  onTaskUpdate: TaskUpdateListener;
  onTaskEvent?: TaskEventListener;
  verifier?: TaskVerifier;
  maxAttempts?: number;
  nowProvider?: () => Date;
}

export class TaskManager {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly events = new Map<string, TaskTimelineEvent[]>();
  private readonly waiters = new Map<string, Promise<TaskRecord>>();
  private activeTaskId: string | null = null;
  private activeExecution: ExecutionHandle | null = null;
  private readonly onTaskUpdate: TaskUpdateListener;
  private readonly onTaskEvent?: TaskEventListener;
  private readonly verifier: TaskVerifier;
  private readonly maxAttempts: number;
  private readonly nowProvider: () => Date;
  private eventSequence = 0;

  constructor(configOrListener: TaskUpdateListener | TaskManagerConfig) {
    if (typeof configOrListener === "function") {
      this.onTaskUpdate = configOrListener;
      this.verifier = new DefaultTaskVerifier();
      this.maxAttempts = 2;
      this.nowProvider = () => new Date();
      return;
    }

    this.onTaskUpdate = configOrListener.onTaskUpdate;
    this.onTaskEvent = configOrListener.onTaskEvent;
    this.verifier = configOrListener.verifier || new DefaultTaskVerifier();
    this.maxAttempts = configOrListener.maxAttempts || 2;
    this.nowProvider = configOrListener.nowProvider || (() => new Date());
  }

  getTask(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  getTaskEvents(taskId: string): TaskTimelineEvent[] {
    return this.events.get(taskId) || [];
  }

  async startTask(prompt: string, runner: ExecutionRunner): Promise<TaskRecord> {
    if (this.activeTaskId && this.isActiveTaskRunning()) {
      throw new Error("Cannot start task: another task is already running");
    }

    const createdTask = createTask(prompt, { now: this.nowProvider });
    this.persistAndEmit(createdTask);
    this.emitTimelineEvent(
      createdTask,
      "task_created",
      `Task created for prompt: ${prompt}`
    );

    this.activeTaskId = createdTask.id;

    const waiter = this.executeTaskLoop(createdTask.id, runner).finally(() => {
      this.activeExecution = null;
      if (this.activeTaskId === createdTask.id) {
        this.activeTaskId = null;
      }
    });

    this.waiters.set(createdTask.id, waiter);
    return this.requireTask(createdTask.id);
  }

  stopTask(
    taskId: string,
    reason: string = "user requested stop"
  ): TaskRecord | null {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    if (task.state !== "running" && task.state !== "blocked") {
      return task;
    }

    const pausedTask = applyTaskEvent(
      task,
      { type: "pause", reason },
      this.nowProvider
    );
    this.persistAndEmit(pausedTask);
    this.emitStateChanged(pausedTask, reason);
    this.emitTimelineEvent(pausedTask, "task_paused", reason, undefined, pausedTask.updatedAt);

    if (this.activeTaskId === taskId && this.activeExecution) {
      this.activeExecution.abort();
    }

    return pausedTask;
  }

  waitForTask(taskId: string): Promise<TaskRecord> {
    const waiter = this.waiters.get(taskId);
    if (waiter) {
      return waiter;
    }
    const task = this.tasks.get(taskId);
    if (!task) {
      return Promise.reject(new Error(`Task not found: ${taskId}`));
    }
    return Promise.resolve(task);
  }

  private async executeTaskLoop(
    taskId: string,
    runner: ExecutionRunner
  ): Promise<TaskRecord> {
    while (true) {
      let task = this.requireTask(taskId);
      const isFirstAttempt = task.attempt === 0;
      task = applyTaskEvent(
        task,
        isFirstAttempt
          ? { type: "start" }
          : { type: "retry", reason: "Retry requested by verifier" },
        this.nowProvider
      );
      task = setTaskPhase(task, "planning", this.nowProvider);
      this.persistAndEmit(task);
      this.emitStateChanged(
        task,
        isFirstAttempt ? "Task started" : "Task retry started"
      );
      this.emitPhaseChanged(task, "Planning workflow");

      let execution: ExecutionHandle;
      try {
        execution = await runner(task, this.createRuntimeHooks(task.id));
      } catch (error) {
        const failedTask = applyTaskEvent(
          task,
          { type: "fail", error: normalizeError(error) },
          this.nowProvider
        );
        this.persistAndEmit(failedTask);
        this.emitStateChanged(failedTask, "Execution runner failed to start");
        this.emitTimelineEvent(
          failedTask,
          "execution_failed",
          normalizeError(error),
          undefined,
          failedTask.updatedAt
        );
        return failedTask;
      }

      this.activeExecution = execution;
      const outcome = await execution.completion.catch((error) => ({
        success: false,
        error: normalizeError(error),
      }));
      this.activeExecution = null;

      task = this.requireTask(taskId);
      if (task.state === "paused") {
        return task;
      }

      task = setTaskPhase(task, "verifying", this.nowProvider);
      this.persistAndEmit(task);
      this.emitPhaseChanged(task, "Verifying execution result");

      this.emitTimelineEvent(
        task,
        outcome.success ? "execution_succeeded" : "execution_failed",
        outcome.success ? "Execution completed" : outcome.error || "Execution failed",
        undefined,
        task.updatedAt
      );

      const decision = await this.verifier.verify({
        task,
        outcome,
        events: this.getTaskEvents(task.id),
      });

      const decisionTask = this.requireTask(taskId);
      const settled = this.applyVerifierDecision(decisionTask, outcome, decision);
      if (settled.shouldContinue) {
        continue;
      }
      return settled.task;
    }
  }

  private applyVerifierDecision(
    task: TaskRecord,
    outcome: ExecutionOutcome,
    decision: VerificationDecision
  ): { task: TaskRecord; shouldContinue: boolean } {
    if (decision.status === "approved") {
      const succeededTask = applyTaskEvent(
        task,
        { type: "succeed", result: outcome.result || "" },
        this.nowProvider
      );
      this.persistAndEmit(succeededTask);
      this.emitTimelineEvent(
        succeededTask,
        "verifier_approved",
        decision.reason,
        undefined,
        succeededTask.updatedAt
      );
      this.emitStateChanged(succeededTask, "Verifier approved result");
      return { task: succeededTask, shouldContinue: false };
    }

    if (decision.status === "blocked") {
      const blockedTask = applyTaskEvent(
        task,
        { type: "block", reason: decision.reason },
        this.nowProvider
      );
      this.persistAndEmit(blockedTask);
      this.emitTimelineEvent(
        blockedTask,
        "verifier_blocked",
        decision.reason,
        undefined,
        blockedTask.updatedAt
      );
      this.emitStateChanged(blockedTask, "Verifier blocked for manual input");
      return { task: blockedTask, shouldContinue: false };
    }

    if (decision.status === "failed") {
      const failedTask = applyTaskEvent(
        task,
        { type: "fail", error: decision.reason },
        this.nowProvider
      );
      this.persistAndEmit(failedTask);
      this.emitTimelineEvent(
        failedTask,
        "verifier_failed",
        decision.reason,
        undefined,
        failedTask.updatedAt
      );
      this.emitStateChanged(failedTask, "Verifier marked task as failed");
      return { task: failedTask, shouldContinue: false };
    }

    if (task.attempt >= this.maxAttempts) {
      const failedTask = applyTaskEvent(
        task,
        {
          type: "fail",
          error: `Reached retry limit (${this.maxAttempts}): ${decision.reason}`,
        },
        this.nowProvider
      );
      this.persistAndEmit(failedTask);
      this.emitTimelineEvent(
        failedTask,
        "verifier_failed",
        decision.reason,
        undefined,
        failedTask.updatedAt
      );
      this.emitStateChanged(failedTask, "Retry limit reached");
      return { task: failedTask, shouldContinue: false };
    }

    let retryTask = setTaskPhase(task, "recovery", this.nowProvider);
    retryTask = {
      ...retryTask,
      error: decision.reason,
    };
    this.persistAndEmit(retryTask);
    this.emitPhaseChanged(retryTask, "Verifier requested another attempt");
    this.emitTimelineEvent(
      retryTask,
      "verifier_retry",
      decision.reason,
      { nextAttempt: retryTask.attempt + 1 },
      retryTask.updatedAt
    );
    return { task: retryTask, shouldContinue: true };
  }

  private createRuntimeHooks(taskId: string): ExecutionRuntimeHooks {
    return {
      onPhase: (phase, detail) => {
        const task = this.requireTask(taskId);
        const nextTask = setTaskPhase(task, phase, this.nowProvider);
        this.persistAndEmit(nextTask);
        this.emitPhaseChanged(nextTask, detail || `Phase -> ${phase}`);
      },
      onStepStart: (stepName, detail) => {
        this.handleStepStart(taskId, stepName, detail);
      },
      onStepEnd: (stepName, detail) => {
        this.handleStepEnd(taskId, stepName, detail);
      },
      onEvent: (name, detail, data) => {
        const task = this.requireTask(taskId);
        this.emitTimelineEvent(task, "runtime_event", detail || name, {
          name,
          ...(data || {}),
        });
      },
    };
  }

  private handleStepStart(taskId: string, stepName: string, detail?: string) {
    let task = this.requireTask(taskId);
    if (task.activeStep && task.activeStep !== stepName) {
      task = this.finishStep(task, task.activeStep, "Switched to next step");
    }

    const nextTask = startTaskStep(task, stepName, this.nowProvider);
    this.persistAndEmit(nextTask);
    this.emitTimelineEvent(
      nextTask,
      "step_started",
      detail || `Step started: ${stepName}`,
      { stepName },
      nextTask.activeStepStartedAt
    );
  }

  private handleStepEnd(taskId: string, stepName: string, detail?: string) {
    const task = this.requireTask(taskId);
    const nextTask = this.finishStep(task, stepName, detail);
    this.persistAndEmit(nextTask);
  }

  private finishStep(task: TaskRecord, stepName: string, detail?: string): TaskRecord {
    const startedAt = task.activeStepStartedAt
      ? new Date(task.activeStepStartedAt).getTime()
      : this.nowProvider().getTime();
    const endedAt = this.nowProvider().getTime();
    const durationMs = Math.max(0, endedAt - startedAt);
    const nextTask = finishTaskStep(task, stepName, durationMs, this.nowProvider);

    this.emitTimelineEvent(
      nextTask,
      "step_finished",
      detail || `Step finished: ${stepName}`,
      { stepName },
      nextTask.updatedAt,
      durationMs
    );

    return nextTask;
  }

  private isActiveTaskRunning(): boolean {
    if (!this.activeTaskId) {
      return false;
    }
    const task = this.tasks.get(this.activeTaskId);
    if (!task) {
      return false;
    }
    return !isTerminalTask(task) && task.state !== "paused";
  }

  private emitStateChanged(task: TaskRecord, detail: string) {
    this.emitTimelineEvent(
      task,
      "state_changed",
      detail,
      {
        state: task.state,
        attempt: task.attempt,
      },
      task.updatedAt
    );
  }

  private emitPhaseChanged(task: TaskRecord, detail: string) {
    this.emitTimelineEvent(
      task,
      "phase_changed",
      detail,
      { phase: task.phase, attempt: task.attempt },
      task.updatedAt
    );
  }

  private emitTimelineEvent(
    task: TaskRecord,
    type: TaskTimelineEventType,
    detail: string,
    data?: Record<string, unknown>,
    at?: string,
    durationMs?: number
  ) {
    const event: TaskTimelineEvent = {
      id: `${task.id}_evt_${this.eventSequence++}`,
      taskId: task.id,
      type,
      at: at || this.nowProvider().toISOString(),
      detail,
      data,
      durationMs,
    };
    const taskEvents = this.events.get(task.id) || [];
    taskEvents.push(event);
    this.events.set(task.id, taskEvents);
    this.onTaskEvent?.(event, task);
  }

  private persistAndEmit(task: TaskRecord): void {
    this.tasks.set(task.id, task);
    this.onTaskUpdate(task);
  }

  private requireTask(taskId: string): TaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
