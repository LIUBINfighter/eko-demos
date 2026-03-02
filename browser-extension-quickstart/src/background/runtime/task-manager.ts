import {
  applyTaskEvent,
  createTask,
  isTerminalTask,
  TaskRecord,
} from "./task-state-machine";

export interface ExecutionOutcome {
  success: boolean;
  result?: string;
  error?: string;
}

export interface ExecutionHandle {
  completion: Promise<ExecutionOutcome>;
  abort: () => void;
}

export type ExecutionRunner = (
  task: TaskRecord
) => Promise<ExecutionHandle> | ExecutionHandle;

export type TaskUpdateListener = (task: TaskRecord) => void;

export class TaskManager {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly waiters = new Map<string, Promise<TaskRecord>>();
  private activeTaskId: string | null = null;
  private activeExecution: ExecutionHandle | null = null;
  private readonly onTaskUpdate: TaskUpdateListener;

  constructor(onTaskUpdate: TaskUpdateListener) {
    this.onTaskUpdate = onTaskUpdate;
  }

  getTask(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  async startTask(
    prompt: string,
    runner: ExecutionRunner
  ): Promise<TaskRecord> {
    if (this.activeTaskId && this.isActiveTaskRunning()) {
      throw new Error("Cannot start task: another task is already running");
    }

    let task = createTask(prompt);
    this.persistAndEmit(task);

    task = applyTaskEvent(task, { type: "start" });
    this.persistAndEmit(task);

    this.activeTaskId = task.id;

    let execution: ExecutionHandle;
    try {
      execution = await runner(task);
    } catch (error) {
      const failedTask = applyTaskEvent(task, {
        type: "fail",
        error: normalizeError(error),
      });
      this.persistAndEmit(failedTask);
      this.activeTaskId = null;
      throw error;
    }

    this.activeExecution = execution;

    const waiter = execution.completion
      .then((outcome) => this.settleTask(task.id, outcome))
      .catch((error) => {
        const latest = this.tasks.get(task.id);
        if (!latest) {
          throw error;
        }
        if (latest.state === "paused") {
          return latest;
        }
        return this.settleTask(task.id, {
          success: false,
          error: normalizeError(error),
        });
      })
      .finally(() => {
        this.activeExecution = null;
        if (this.activeTaskId === task.id) {
          this.activeTaskId = null;
        }
      });

    this.waiters.set(task.id, waiter);
    return task;
  }

  stopTask(taskId: string, reason: string = "user requested stop"): TaskRecord | null {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    if (task.state !== "running" && task.state !== "blocked") {
      return task;
    }

    const pausedTask = applyTaskEvent(task, { type: "pause", reason });
    this.persistAndEmit(pausedTask);

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

  private settleTask(taskId: string, outcome: ExecutionOutcome): TaskRecord {
    const current = this.tasks.get(taskId);
    if (!current) {
      throw new Error(`Task not found while settling: ${taskId}`);
    }

    if (current.state === "paused") {
      return current;
    }

    const nextTask = outcome.success
      ? applyTaskEvent(current, {
          type: "succeed",
          result: outcome.result || "",
        })
      : applyTaskEvent(current, {
          type: "fail",
          error: outcome.error || "Task failed",
        });

    this.persistAndEmit(nextTask);
    return nextTask;
  }

  private persistAndEmit(task: TaskRecord): void {
    this.tasks.set(task.id, task);
    this.onTaskUpdate(task);
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
