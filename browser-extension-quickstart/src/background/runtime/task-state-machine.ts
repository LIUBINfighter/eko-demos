export type TaskState =
  | "created"
  | "running"
  | "blocked"
  | "paused"
  | "succeeded"
  | "failed";

export interface TaskRecord {
  id: string;
  prompt: string;
  state: TaskState;
  createdAt: string;
  updatedAt: string;
  attempt: number;
  result?: string;
  error?: string;
}

export type TaskEvent =
  | { type: "start" }
  | { type: "block"; reason: string }
  | { type: "resume" }
  | { type: "pause"; reason: string }
  | { type: "succeed"; result: string }
  | { type: "fail"; error: string };

type Now = () => Date;
type IdGenerator = () => string;

const ALLOWED_TRANSITIONS: Record<TaskState, TaskState[]> = {
  created: ["running"],
  running: ["blocked", "paused", "succeeded", "failed"],
  blocked: ["running", "paused", "failed"],
  paused: ["running", "failed"],
  succeeded: [],
  failed: [],
};

function defaultNow(): Date {
  return new Date();
}

function defaultTaskIdGenerator(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createTask(
  prompt: string,
  options?: {
    now?: Now;
    idGenerator?: IdGenerator;
  }
): TaskRecord {
  const now = (options?.now || defaultNow)().toISOString();
  const id = (options?.idGenerator || defaultTaskIdGenerator)();

  return {
    id,
    prompt,
    state: "created",
    createdAt: now,
    updatedAt: now,
    attempt: 0,
  };
}

export function isTerminalTask(task: TaskRecord): boolean {
  return task.state === "succeeded" || task.state === "failed";
}

export function applyTaskEvent(
  task: TaskRecord,
  event: TaskEvent,
  nowProvider: Now = defaultNow
): TaskRecord {
  const nextState = stateFromEvent(event);
  const allowed = ALLOWED_TRANSITIONS[task.state];
  if (!allowed.includes(nextState)) {
    throw new Error(
      `Invalid task transition: ${task.state} -> ${nextState} for event ${event.type}`
    );
  }

  const nextTask: TaskRecord = {
    ...task,
    state: nextState,
    updatedAt: nowProvider().toISOString(),
  };

  switch (event.type) {
    case "start":
      nextTask.attempt = task.attempt + 1;
      nextTask.error = undefined;
      nextTask.result = undefined;
      break;
    case "block":
      nextTask.error = event.reason;
      break;
    case "resume":
      nextTask.error = undefined;
      break;
    case "pause":
      nextTask.error = event.reason;
      break;
    case "succeed":
      nextTask.result = event.result;
      nextTask.error = undefined;
      break;
    case "fail":
      nextTask.error = event.error;
      break;
    default:
      break;
  }

  return nextTask;
}

function stateFromEvent(event: TaskEvent): TaskState {
  switch (event.type) {
    case "start":
    case "resume":
      return "running";
    case "block":
      return "blocked";
    case "pause":
      return "paused";
    case "succeed":
      return "succeeded";
    case "fail":
      return "failed";
    default:
      return "failed";
  }
}
