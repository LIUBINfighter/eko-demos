"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskManager = void 0;
const task_state_machine_1 = require("./task-state-machine");
const task_verifier_1 = require("./task-verifier");
class TaskManager {
    constructor(configOrListener) {
        this.tasks = new Map();
        this.events = new Map();
        this.waiters = new Map();
        this.activeTaskId = null;
        this.activeExecution = null;
        this.eventSequence = 0;
        if (typeof configOrListener === "function") {
            this.onTaskUpdate = configOrListener;
            this.verifier = new task_verifier_1.DefaultTaskVerifier();
            this.maxAttempts = 2;
            this.nowProvider = () => new Date();
            return;
        }
        this.onTaskUpdate = configOrListener.onTaskUpdate;
        this.onTaskEvent = configOrListener.onTaskEvent;
        this.verifier = configOrListener.verifier || new task_verifier_1.DefaultTaskVerifier();
        this.maxAttempts = configOrListener.maxAttempts || 2;
        this.nowProvider = configOrListener.nowProvider || (() => new Date());
    }
    getTask(taskId) {
        return this.tasks.get(taskId);
    }
    getTaskEvents(taskId) {
        return this.events.get(taskId) || [];
    }
    async startTask(prompt, runner) {
        if (this.activeTaskId && this.isActiveTaskRunning()) {
            throw new Error("Cannot start task: another task is already running");
        }
        const createdTask = (0, task_state_machine_1.createTask)(prompt, { now: this.nowProvider });
        this.persistAndEmit(createdTask);
        this.emitTimelineEvent(createdTask, "task_created", `Task created for prompt: ${prompt}`);
        this.activeTaskId = createdTask.id;
        const waiter = this.executeTaskLoop(createdTask.id, runner).finally(() => {
            this.activeExecution = null;
            if (this.activeTaskId === createdTask.id) {
                this.activeTaskId = null;
            }
        });
        this.waiters.set(createdTask.id, waiter);
        return this.requireTask(createdTask.id);
    }
    stopTask(taskId, reason = "user requested stop") {
        const task = this.tasks.get(taskId);
        if (!task) {
            return null;
        }
        if (task.state !== "running" && task.state !== "blocked") {
            return task;
        }
        const pausedTask = (0, task_state_machine_1.applyTaskEvent)(task, { type: "pause", reason }, this.nowProvider);
        this.persistAndEmit(pausedTask);
        this.emitStateChanged(pausedTask, reason);
        this.emitTimelineEvent(pausedTask, "task_paused", reason, undefined, pausedTask.updatedAt);
        if (this.activeTaskId === taskId && this.activeExecution) {
            this.activeExecution.abort();
        }
        return pausedTask;
    }
    waitForTask(taskId) {
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
    async executeTaskLoop(taskId, runner) {
        while (true) {
            let task = this.requireTask(taskId);
            const isFirstAttempt = task.attempt === 0;
            task = (0, task_state_machine_1.applyTaskEvent)(task, isFirstAttempt
                ? { type: "start" }
                : { type: "retry", reason: "Retry requested by verifier" }, this.nowProvider);
            task = (0, task_state_machine_1.setTaskPhase)(task, "planning", this.nowProvider);
            this.persistAndEmit(task);
            this.emitStateChanged(task, isFirstAttempt ? "Task started" : "Task retry started");
            this.emitPhaseChanged(task, "Planning workflow");
            let execution;
            try {
                execution = await runner(task, this.createRuntimeHooks(task.id));
            }
            catch (error) {
                const failedTask = (0, task_state_machine_1.applyTaskEvent)(task, { type: "fail", error: normalizeError(error) }, this.nowProvider);
                this.persistAndEmit(failedTask);
                this.emitStateChanged(failedTask, "Execution runner failed to start");
                this.emitTimelineEvent(failedTask, "execution_failed", normalizeError(error), undefined, failedTask.updatedAt);
                return failedTask;
            }
            this.activeExecution = execution;
            const outcome = await execution.completion.catch((error) => ({
                success: false,
                error: normalizeError(error),
            }));
            this.activeExecution = null;
            task = this.requireTask(taskId);
            if (task.state === "paused") {
                return task;
            }
            task = (0, task_state_machine_1.setTaskPhase)(task, "verifying", this.nowProvider);
            this.persistAndEmit(task);
            this.emitPhaseChanged(task, "Verifying execution result");
            this.emitTimelineEvent(task, outcome.success ? "execution_succeeded" : "execution_failed", outcome.success ? "Execution completed" : outcome.error || "Execution failed", undefined, task.updatedAt);
            const decision = await this.verifier.verify({
                task,
                outcome,
                events: this.getTaskEvents(task.id),
            });
            const decisionTask = this.requireTask(taskId);
            const settled = this.applyVerifierDecision(decisionTask, outcome, decision);
            if (settled.shouldContinue) {
                continue;
            }
            return settled.task;
        }
    }
    applyVerifierDecision(task, outcome, decision) {
        if (decision.status === "approved") {
            const succeededTask = (0, task_state_machine_1.applyTaskEvent)(task, { type: "succeed", result: outcome.result || "" }, this.nowProvider);
            this.persistAndEmit(succeededTask);
            this.emitTimelineEvent(succeededTask, "verifier_approved", decision.reason, undefined, succeededTask.updatedAt);
            this.emitStateChanged(succeededTask, "Verifier approved result");
            return { task: succeededTask, shouldContinue: false };
        }
        if (decision.status === "blocked") {
            const blockedTask = (0, task_state_machine_1.applyTaskEvent)(task, { type: "block", reason: decision.reason }, this.nowProvider);
            this.persistAndEmit(blockedTask);
            this.emitTimelineEvent(blockedTask, "verifier_blocked", decision.reason, undefined, blockedTask.updatedAt);
            this.emitStateChanged(blockedTask, "Verifier blocked for manual input");
            return { task: blockedTask, shouldContinue: false };
        }
        if (decision.status === "failed") {
            const failedTask = (0, task_state_machine_1.applyTaskEvent)(task, { type: "fail", error: decision.reason }, this.nowProvider);
            this.persistAndEmit(failedTask);
            this.emitTimelineEvent(failedTask, "verifier_failed", decision.reason, undefined, failedTask.updatedAt);
            this.emitStateChanged(failedTask, "Verifier marked task as failed");
            return { task: failedTask, shouldContinue: false };
        }
        if (task.attempt >= this.maxAttempts) {
            const failedTask = (0, task_state_machine_1.applyTaskEvent)(task, {
                type: "fail",
                error: `Reached retry limit (${this.maxAttempts}): ${decision.reason}`,
            }, this.nowProvider);
            this.persistAndEmit(failedTask);
            this.emitTimelineEvent(failedTask, "verifier_failed", decision.reason, undefined, failedTask.updatedAt);
            this.emitStateChanged(failedTask, "Retry limit reached");
            return { task: failedTask, shouldContinue: false };
        }
        let retryTask = (0, task_state_machine_1.setTaskPhase)(task, "recovery", this.nowProvider);
        retryTask = {
            ...retryTask,
            error: decision.reason,
        };
        this.persistAndEmit(retryTask);
        this.emitPhaseChanged(retryTask, "Verifier requested another attempt");
        this.emitTimelineEvent(retryTask, "verifier_retry", decision.reason, { nextAttempt: retryTask.attempt + 1 }, retryTask.updatedAt);
        return { task: retryTask, shouldContinue: true };
    }
    createRuntimeHooks(taskId) {
        return {
            onPhase: (phase, detail) => {
                const task = this.requireTask(taskId);
                const nextTask = (0, task_state_machine_1.setTaskPhase)(task, phase, this.nowProvider);
                this.persistAndEmit(nextTask);
                this.emitPhaseChanged(nextTask, detail || `Phase -> ${phase}`);
            },
            onStepStart: (stepName, detail) => {
                this.handleStepStart(taskId, stepName, detail);
            },
            onStepEnd: (stepName, detail) => {
                this.handleStepEnd(taskId, stepName, detail);
            },
            onEvent: (name, detail, data) => {
                const task = this.requireTask(taskId);
                this.emitTimelineEvent(task, "runtime_event", detail || name, {
                    name,
                    ...(data || {}),
                });
            },
        };
    }
    handleStepStart(taskId, stepName, detail) {
        let task = this.requireTask(taskId);
        if (task.activeStep && task.activeStep !== stepName) {
            task = this.finishStep(task, task.activeStep, "Switched to next step");
        }
        const nextTask = (0, task_state_machine_1.startTaskStep)(task, stepName, this.nowProvider);
        this.persistAndEmit(nextTask);
        this.emitTimelineEvent(nextTask, "step_started", detail || `Step started: ${stepName}`, { stepName }, nextTask.activeStepStartedAt);
    }
    handleStepEnd(taskId, stepName, detail) {
        const task = this.requireTask(taskId);
        const nextTask = this.finishStep(task, stepName, detail);
        this.persistAndEmit(nextTask);
    }
    finishStep(task, stepName, detail) {
        const startedAt = task.activeStepStartedAt
            ? new Date(task.activeStepStartedAt).getTime()
            : this.nowProvider().getTime();
        const endedAt = this.nowProvider().getTime();
        const durationMs = Math.max(0, endedAt - startedAt);
        const nextTask = (0, task_state_machine_1.finishTaskStep)(task, stepName, durationMs, this.nowProvider);
        this.emitTimelineEvent(nextTask, "step_finished", detail || `Step finished: ${stepName}`, { stepName }, nextTask.updatedAt, durationMs);
        return nextTask;
    }
    isActiveTaskRunning() {
        if (!this.activeTaskId) {
            return false;
        }
        const task = this.tasks.get(this.activeTaskId);
        if (!task) {
            return false;
        }
        return !(0, task_state_machine_1.isTerminalTask)(task) && task.state !== "paused";
    }
    emitStateChanged(task, detail) {
        this.emitTimelineEvent(task, "state_changed", detail, {
            state: task.state,
            attempt: task.attempt,
        }, task.updatedAt);
    }
    emitPhaseChanged(task, detail) {
        this.emitTimelineEvent(task, "phase_changed", detail, { phase: task.phase, attempt: task.attempt }, task.updatedAt);
    }
    emitTimelineEvent(task, type, detail, data, at, durationMs) {
        const event = {
            id: `${task.id}_evt_${this.eventSequence++}`,
            taskId: task.id,
            type,
            at: at || this.nowProvider().toISOString(),
            detail,
            data,
            durationMs,
        };
        const taskEvents = this.events.get(task.id) || [];
        taskEvents.push(event);
        this.events.set(task.id, taskEvents);
        this.onTaskEvent?.(event, task);
    }
    persistAndEmit(task) {
        this.tasks.set(task.id, task);
        this.onTaskUpdate(task);
    }
    requireTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task not found: ${taskId}`);
        }
        return task;
    }
}
exports.TaskManager = TaskManager;
function normalizeError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
