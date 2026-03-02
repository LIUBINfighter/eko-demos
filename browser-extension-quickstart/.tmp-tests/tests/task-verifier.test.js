"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const task_state_machine_1 = require("../src/background/runtime/task-state-machine");
const task_verifier_1 = require("../src/background/runtime/task-verifier");
(0, node_test_1.default)("approves successful and meaningful results", async () => {
    const verifier = new task_verifier_1.DefaultTaskVerifier();
    const task = (0, task_state_machine_1.createTask)("verify");
    const decision = await verifier.verify({
        task: { ...task, attempt: 1 },
        outcome: { success: true, result: "Login completed and profile page opened." },
        events: [],
    });
    strict_1.default.equal(decision.status, "approved");
});
(0, node_test_1.default)("requests retry when result looks incomplete", async () => {
    const verifier = new task_verifier_1.DefaultTaskVerifier();
    const task = (0, task_state_machine_1.createTask)("verify");
    const decision = await verifier.verify({
        task: { ...task, attempt: 1 },
        outcome: { success: true, result: "done" },
        events: [],
    });
    strict_1.default.equal(decision.status, "retry");
});
(0, node_test_1.default)("fails after reaching max attempts with weak output", async () => {
    const verifier = new task_verifier_1.DefaultTaskVerifier({ minResultLength: 20 });
    const task = (0, task_state_machine_1.createTask)("verify");
    const decision = await verifier.verify({
        task: { ...task, attempt: 3 },
        outcome: { success: false, error: "tool timeout" },
        events: [],
    });
    strict_1.default.equal(decision.status, "failed");
});
