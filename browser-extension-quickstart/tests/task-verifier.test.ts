import assert from "node:assert/strict";
import test from "node:test";
import { createTask } from "../src/background/runtime/task-state-machine";
import { DefaultTaskVerifier } from "../src/background/runtime/task-verifier";

test("approves successful and meaningful results", async () => {
  const verifier = new DefaultTaskVerifier();
  const task = createTask("verify");
  const decision = await verifier.verify({
    task: { ...task, attempt: 1 },
    outcome: { success: true, result: "Login completed and profile page opened." },
    events: [],
  });

  assert.equal(decision.status, "approved");
});

test("requests retry when result looks incomplete", async () => {
  const verifier = new DefaultTaskVerifier();
  const task = createTask("verify");
  const decision = await verifier.verify({
    task: { ...task, attempt: 1 },
    outcome: { success: true, result: "done" },
    events: [],
  });

  assert.equal(decision.status, "retry");
});

test("fails after reaching max attempts with weak output", async () => {
  const verifier = new DefaultTaskVerifier({ minResultLength: 20 });
  const task = createTask("verify");
  const decision = await verifier.verify({
    task: { ...task, attempt: 3 },
    outcome: { success: false, error: "tool timeout" },
    events: [],
  });

  assert.equal(decision.status, "failed");
});
