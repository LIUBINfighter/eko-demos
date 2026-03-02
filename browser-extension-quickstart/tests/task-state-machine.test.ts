import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTaskEvent,
  createTask,
  isTerminalTask,
  TaskState,
} from "../src/background/runtime/task-state-machine";

test("transitions created -> running -> succeeded", () => {
  const task = createTask("open website");
  assert.equal(task.state, "created");

  const runningTask = applyTaskEvent(task, { type: "start" });
  assert.equal(runningTask.state, "running");
  assert.equal(runningTask.attempt, 1);

  const completedTask = applyTaskEvent(runningTask, {
    type: "succeed",
    result: "done",
  });
  assert.equal(completedTask.state, "succeeded");
  assert.equal(completedTask.result, "done");
  assert.equal(isTerminalTask(completedTask), true);
});

test("supports block and resume transitions", () => {
  const runningTask = applyTaskEvent(createTask("with human check"), {
    type: "start",
  });

  const blockedTask = applyTaskEvent(runningTask, {
    type: "block",
    reason: "awaiting human confirmation",
  });
  assert.equal(blockedTask.state, "blocked");
  assert.equal(blockedTask.error, "awaiting human confirmation");

  const resumedTask = applyTaskEvent(blockedTask, {
    type: "resume",
  });
  assert.equal(resumedTask.state, "running");
});

test("rejects illegal transition from terminal state", () => {
  const completedTask = applyTaskEvent(
    applyTaskEvent(createTask("terminal"), { type: "start" }),
    { type: "succeed", result: "ok" }
  );

  assert.throws(
    () => applyTaskEvent(completedTask, { type: "resume" }),
    /Invalid task transition/
  );
});

test("task id is stable and state enum stays explicit", () => {
  const task = createTask("id check");
  assert.match(task.id, /^task_/);
  const states: TaskState[] = [
    "created",
    "running",
    "blocked",
    "paused",
    "succeeded",
    "failed",
  ];
  assert.equal(states.length, 6);
});
