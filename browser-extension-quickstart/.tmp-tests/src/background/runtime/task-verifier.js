"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultTaskVerifier = void 0;
class DefaultTaskVerifier {
    constructor(options) {
        this.minResultLength = options?.minResultLength ?? 12;
        this.maxRetryAttempts = options?.maxRetryAttempts ?? 2;
    }
    verify(context) {
        const { task, outcome } = context;
        const resultText = (outcome.result || "").trim();
        if (!outcome.success) {
            if (task.attempt > this.maxRetryAttempts) {
                return {
                    status: "failed",
                    reason: outcome.error || "Execution failed after retries",
                };
            }
            return {
                status: "retry",
                reason: outcome.error || "Execution failed, retrying",
            };
        }
        if (looksBlocked(resultText)) {
            return {
                status: "blocked",
                reason: "Execution requires manual confirmation",
            };
        }
        if (resultText.length < this.minResultLength || looksWeakResult(resultText)) {
            if (task.attempt > this.maxRetryAttempts) {
                return {
                    status: "failed",
                    reason: "Result remained incomplete after retries",
                };
            }
            return {
                status: "retry",
                reason: "Result seems incomplete, request another pass",
            };
        }
        return {
            status: "approved",
            reason: "Result appears complete",
        };
    }
}
exports.DefaultTaskVerifier = DefaultTaskVerifier;
function looksWeakResult(text) {
    const weakPatterns = [/^ok$/i, /^done$/i, /^success$/i, /^completed$/i];
    return weakPatterns.some((pattern) => pattern.test(text));
}
function looksBlocked(text) {
    const blockedPatterns = [/need .*confirm/i, /manual/i, /permission/i];
    return blockedPatterns.some((pattern) => pattern.test(text));
}
