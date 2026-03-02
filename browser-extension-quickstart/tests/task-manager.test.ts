import assert from "node:assert/strict";
import test from "node:test";
import {
  ExecutionRuntimeHooks,
  ExecutionOutcome,
  ExecutionRunner,
  TaskEventListener,
  TaskManager,
  TaskUpdateListener,
} from "../src/background/runtime/task-manager";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("startTask emits lifecycle updates and ends in succeeded", async () => {
  const updates: string[] = [];
  const listener: TaskUpdateListener = (task) => {
    updates.push(task.state);
  };

  const manager = new TaskManager({
    onTaskUpdate: listener,
    verifier: {
      verify: () => ({
        status: "approved",
        reason: "explicitly approved in test",
      }),
    },
  });
  const deferred = createDeferred<ExecutionOutcome>();

  const runner: ExecutionRunner = async () => ({
    completion: deferred.promise,
    abort: () => {},
  });

  const task = await manager.startTask("open docs", runner);
  assert.equal(task.state, "running");

  deferred.resolve({ success: true, result: "ok" });
  await manager.waitForTask(task.id);

  assert.equal(updates[0], "created");
  assert.equal(updates.includes("running"), true);
  assert.equal(updates[updates.length - 1], "succeeded");
  assert.equal(manager.getTask(task.id)?.result, "ok");
});

test("stopTask transitions running task to paused and calls abort", async () => {
  let aborted = false;
  const manager = new TaskManager(() => {});
  const deferred = createDeferred<ExecutionOutcome>();

  const runner: ExecutionRunner = async () => ({
    completion: deferred.promise,
    abort: () => {
      aborted = true;
      deferred.reject(new Error("aborted"));
    },
  });

  const task = await manager.startTask("long task", runner);
  const paused = manager.stopTask(task.id, "user request");

  assert.equal(paused?.state, "paused");
  assert.equal(aborted, true);
});

test("startTask fails when another task is running", async () => {
  const deferred = createDeferred<ExecutionOutcome>();
  const manager = new TaskManager(() => {});
  const runner: ExecutionRunner = async () => ({
    completion: deferred.promise,
    abort: () => {},
  });

  await manager.startTask("first", runner);

  await assert.rejects(
    () => manager.startTask("second", runner),
    /another task is already running/
  );

  deferred.resolve({ success: true, result: "done" });
});

test("verifier can request retry and task succeeds on next attempt", async () => {
  let runCount = 0;
  const eventTypes: string[] = [];
  const eventListener: TaskEventListener = (event) => {
    eventTypes.push(event.type);
  };

  const manager = new TaskManager({
    onTaskUpdate: () => {},
    onTaskEvent: eventListener,
    maxAttempts: 3,
    verifier: {
      verify: async ({ task }) => {
        if (task.attempt < 2) {
          return {
            status: "retry",
            reason: "result not complete yet",
          };
        }
        return {
          status: "approved",
          reason: "result is complete",
        };
      },
    },
  });

  const runner: ExecutionRunner = async () => {
    runCount += 1;
    return {
      completion: Promise.resolve({
        success: true,
        result: runCount === 1 ? "partial result" : "complete result",
      }),
      abort: () => {},
    };
  };

  const task = await manager.startTask("retryable task", runner);
  const finalTask = await manager.waitForTask(task.id);

  assert.equal(runCount, 2);
  assert.equal(finalTask.state, "succeeded");
  assert.equal(finalTask.attempt, 2);
  assert.equal(eventTypes.includes("verifier_retry"), true);
});

test("runtime hooks emit step events and step duration", async () => {
  const eventTypes: string[] = [];
  let nowTicks = 0;
  const nowProvider = () => {
    const base = new Date("2026-03-02T00:00:00.000Z").getTime();
    const next = new Date(base + nowTicks * 1000);
    nowTicks += 1;
    return next;
  };

  const manager = new TaskManager({
    onTaskUpdate: () => {},
    onTaskEvent: (event) => {
      eventTypes.push(event.type);
    },
    nowProvider,
  });

  const runner: ExecutionRunner = async (
    _task,
    hooks: ExecutionRuntimeHooks
  ) => {
    hooks.onPhase("planning", "building workflow");
    hooks.onStepStart("Plan", "generate workflow");
    hooks.onStepEnd("Plan", "workflow generated");
    hooks.onPhase("executing", "running tools");
    return {
      completion: Promise.resolve({
        success: true,
        result: "done",
      }),
      abort: () => {},
    };
  };

  const task = await manager.startTask("verbose task", runner);
  const finalTask = await manager.waitForTask(task.id);

  assert.equal(finalTask.lastCompletedStep, "Plan");
  assert.equal(finalTask.lastCompletedStepDurationMs, 1000);
  assert.equal(eventTypes.includes("step_started"), true);
  assert.equal(eventTypes.includes("step_finished"), true);
  assert.equal(eventTypes.includes("phase_changed"), true);
});
