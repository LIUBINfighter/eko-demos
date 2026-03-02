import assert from "node:assert/strict";
import test from "node:test";
import {
  ExecutionOutcome,
  ExecutionRunner,
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

  const manager = new TaskManager(listener);
  const deferred = createDeferred<ExecutionOutcome>();

  const runner: ExecutionRunner = async () => ({
    completion: deferred.promise,
    abort: () => {},
  });

  const task = await manager.startTask("open docs", runner);
  assert.equal(task.state, "running");

  deferred.resolve({ success: true, result: "ok" });
  await manager.waitForTask(task.id);

  assert.deepEqual(updates, ["created", "running", "succeeded"]);
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
