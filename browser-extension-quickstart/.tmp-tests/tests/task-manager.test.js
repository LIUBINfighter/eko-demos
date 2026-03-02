"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const task_manager_1 = require("../src/background/runtime/task-manager");
function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
(0, node_test_1.default)("startTask emits lifecycle updates and ends in succeeded", async () => {
    const updates = [];
    const listener = (task) => {
        updates.push(task.state);
    };
    const manager = new task_manager_1.TaskManager({
        onTaskUpdate: listener,
        verifier: {
            verify: () => ({
                status: "approved",
                reason: "explicitly approved in test",
            }),
        },
    });
    const deferred = createDeferred();
    const runner = async () => ({
        completion: deferred.promise,
        abort: () => { },
    });
    const task = await manager.startTask("open docs", runner);
    strict_1.default.equal(task.state, "running");
    deferred.resolve({ success: true, result: "ok" });
    await manager.waitForTask(task.id);
    strict_1.default.equal(updates[0], "created");
    strict_1.default.equal(updates.includes("running"), true);
    strict_1.default.equal(updates[updates.length - 1], "succeeded");
    strict_1.default.equal(manager.getTask(task.id)?.result, "ok");
});
(0, node_test_1.default)("stopTask transitions running task to paused and calls abort", async () => {
    let aborted = false;
    const manager = new task_manager_1.TaskManager(() => { });
    const deferred = createDeferred();
    const runner = async () => ({
        completion: deferred.promise,
        abort: () => {
            aborted = true;
            deferred.reject(new Error("aborted"));
        },
    });
    const task = await manager.startTask("long task", runner);
    const paused = manager.stopTask(task.id, "user request");
    strict_1.default.equal(paused?.state, "paused");
    strict_1.default.equal(aborted, true);
});
(0, node_test_1.default)("startTask fails when another task is running", async () => {
    const deferred = createDeferred();
    const manager = new task_manager_1.TaskManager(() => { });
    const runner = async () => ({
        completion: deferred.promise,
        abort: () => { },
    });
    await manager.startTask("first", runner);
    await strict_1.default.rejects(() => manager.startTask("second", runner), /another task is already running/);
    deferred.resolve({ success: true, result: "done" });
});
(0, node_test_1.default)("verifier can request retry and task succeeds on next attempt", async () => {
    let runCount = 0;
    const eventTypes = [];
    const eventListener = (event) => {
        eventTypes.push(event.type);
    };
    const manager = new task_manager_1.TaskManager({
        onTaskUpdate: () => { },
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
    const runner = async () => {
        runCount += 1;
        return {
            completion: Promise.resolve({
                success: true,
                result: runCount === 1 ? "partial result" : "complete result",
            }),
            abort: () => { },
        };
    };
    const task = await manager.startTask("retryable task", runner);
    const finalTask = await manager.waitForTask(task.id);
    strict_1.default.equal(runCount, 2);
    strict_1.default.equal(finalTask.state, "succeeded");
    strict_1.default.equal(finalTask.attempt, 2);
    strict_1.default.equal(eventTypes.includes("verifier_retry"), true);
});
(0, node_test_1.default)("runtime hooks emit step events and step duration", async () => {
    const eventTypes = [];
    let nowTicks = 0;
    const nowProvider = () => {
        const base = new Date("2026-03-02T00:00:00.000Z").getTime();
        const next = new Date(base + nowTicks * 1000);
        nowTicks += 1;
        return next;
    };
    const manager = new task_manager_1.TaskManager({
        onTaskUpdate: () => { },
        onTaskEvent: (event) => {
            eventTypes.push(event.type);
        },
        nowProvider,
    });
    const runner = async (_task, hooks) => {
        hooks.onPhase("planning", "building workflow");
        hooks.onStepStart("Plan", "generate workflow");
        hooks.onStepEnd("Plan", "workflow generated");
        hooks.onPhase("executing", "running tools");
        return {
            completion: Promise.resolve({
                success: true,
                result: "done",
            }),
            abort: () => { },
        };
    };
    const task = await manager.startTask("verbose task", runner);
    const finalTask = await manager.waitForTask(task.id);
    strict_1.default.equal(finalTask.lastCompletedStep, "Plan");
    strict_1.default.equal(finalTask.lastCompletedStepDurationMs, 1000);
    strict_1.default.equal(eventTypes.includes("step_started"), true);
    strict_1.default.equal(eventTypes.includes("step_finished"), true);
    strict_1.default.equal(eventTypes.includes("phase_changed"), true);
});
