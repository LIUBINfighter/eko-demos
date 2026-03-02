"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTask = createTask;
exports.isTerminalTask = isTerminalTask;
exports.applyTaskEvent = applyTaskEvent;
exports.setTaskPhase = setTaskPhase;
exports.startTaskStep = startTaskStep;
exports.finishTaskStep = finishTaskStep;
const ALLOWED_TRANSITIONS = {
    created: ["running"],
    running: ["running", "blocked", "paused", "succeeded", "failed"],
    blocked: ["running", "paused", "failed"],
    paused: ["running", "failed"],
    succeeded: [],
    failed: [],
};
function defaultNow() {
    return new Date();
}
function defaultTaskIdGenerator() {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function createTask(prompt, options) {
    const now = (options?.now || defaultNow)().toISOString();
    const id = (options?.idGenerator || defaultTaskIdGenerator)();
    return {
        id,
        prompt,
        state: "created",
        phase: "intake",
        createdAt: now,
        updatedAt: now,
        attempt: 0,
    };
}
function isTerminalTask(task) {
    return task.state === "succeeded" || task.state === "failed";
}
function applyTaskEvent(task, event, nowProvider = defaultNow) {
    const nextState = stateFromEvent(event);
    const allowed = ALLOWED_TRANSITIONS[task.state];
    if (!allowed.includes(nextState)) {
        throw new Error(`Invalid task transition: ${task.state} -> ${nextState} for event ${event.type}`);
    }
    const nextTask = {
        ...task,
        state: nextState,
        updatedAt: nowProvider().toISOString(),
    };
    switch (event.type) {
        case "start":
        case "retry":
            nextTask.attempt = task.attempt + 1;
            nextTask.result = undefined;
            nextTask.error = event.type === "retry" ? event.reason : undefined;
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
function stateFromEvent(event) {
    switch (event.type) {
        case "start":
        case "retry":
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
function setTaskPhase(task, phase, nowProvider = defaultNow) {
    return {
        ...task,
        phase,
        updatedAt: nowProvider().toISOString(),
    };
}
function startTaskStep(task, stepName, nowProvider = defaultNow) {
    const now = nowProvider().toISOString();
    return {
        ...task,
        activeStep: stepName,
        activeStepStartedAt: now,
        updatedAt: now,
    };
}
function finishTaskStep(task, stepName, durationMs, nowProvider = defaultNow) {
    return {
        ...task,
        activeStep: undefined,
        activeStepStartedAt: undefined,
        lastCompletedStep: stepName,
        lastCompletedStepDurationMs: durationMs,
        updatedAt: nowProvider().toISOString(),
    };
}
