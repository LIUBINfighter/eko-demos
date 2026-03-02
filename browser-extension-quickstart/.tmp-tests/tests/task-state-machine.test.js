"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const task_state_machine_1 = require("../src/background/runtime/task-state-machine");
(0, node_test_1.default)("transitions created -> running -> succeeded", () => {
    const task = (0, task_state_machine_1.createTask)("open website");
    strict_1.default.equal(task.state, "created");
    const runningTask = (0, task_state_machine_1.applyTaskEvent)(task, { type: "start" });
    strict_1.default.equal(runningTask.state, "running");
    strict_1.default.equal(runningTask.attempt, 1);
    const completedTask = (0, task_state_machine_1.applyTaskEvent)(runningTask, {
        type: "succeed",
        result: "done",
    });
    strict_1.default.equal(completedTask.state, "succeeded");
    strict_1.default.equal(completedTask.result, "done");
    strict_1.default.equal((0, task_state_machine_1.isTerminalTask)(completedTask), true);
});
(0, node_test_1.default)("supports block and resume transitions", () => {
    const runningTask = (0, task_state_machine_1.applyTaskEvent)((0, task_state_machine_1.createTask)("with human check"), {
        type: "start",
    });
    const blockedTask = (0, task_state_machine_1.applyTaskEvent)(runningTask, {
        type: "block",
        reason: "awaiting human confirmation",
    });
    strict_1.default.equal(blockedTask.state, "blocked");
    strict_1.default.equal(blockedTask.error, "awaiting human confirmation");
    const resumedTask = (0, task_state_machine_1.applyTaskEvent)(blockedTask, {
        type: "resume",
    });
    strict_1.default.equal(resumedTask.state, "running");
});
(0, node_test_1.default)("rejects illegal transition from terminal state", () => {
    const completedTask = (0, task_state_machine_1.applyTaskEvent)((0, task_state_machine_1.applyTaskEvent)((0, task_state_machine_1.createTask)("terminal"), { type: "start" }), { type: "succeed", result: "ok" });
    strict_1.default.throws(() => (0, task_state_machine_1.applyTaskEvent)(completedTask, { type: "resume" }), /Invalid task transition/);
});
(0, node_test_1.default)("task id is stable and state enum stays explicit", () => {
    const task = (0, task_state_machine_1.createTask)("id check");
    strict_1.default.match(task.id, /^task_/);
    strict_1.default.equal(task.phase, "intake");
    const states = [
        "created",
        "running",
        "blocked",
        "paused",
        "succeeded",
        "failed",
    ];
    strict_1.default.equal(states.length, 6);
});
(0, node_test_1.default)("retry keeps task running and increments attempt", () => {
    const task = (0, task_state_machine_1.applyTaskEvent)((0, task_state_machine_1.createTask)("retry task"), { type: "start" });
    strict_1.default.equal(task.attempt, 1);
    const retriedTask = (0, task_state_machine_1.applyTaskEvent)(task, {
        type: "retry",
        reason: "verifier requested another pass",
    });
    strict_1.default.equal(retriedTask.state, "running");
    strict_1.default.equal(retriedTask.attempt, 2);
    strict_1.default.equal(retriedTask.error, "verifier requested another pass");
});
