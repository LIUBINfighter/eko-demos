import type { TaskRecord } from "./task-state-machine";
import type { ExecutionOutcome, TaskTimelineEvent } from "./task-manager";

export type VerificationStatus = "approved" | "retry" | "blocked" | "failed";

export interface VerificationDecision {
  status: VerificationStatus;
  reason: string;
}

export interface VerificationContext {
  task: TaskRecord;
  outcome: ExecutionOutcome;
  events: TaskTimelineEvent[];
}

export interface TaskVerifier {
  verify(
    context: VerificationContext
  ): Promise<VerificationDecision> | VerificationDecision;
}

export class DefaultTaskVerifier implements TaskVerifier {
  private readonly minResultLength: number;
  private readonly maxRetryAttempts: number;

  constructor(options?: {
    minResultLength?: number;
    maxRetryAttempts?: number;
  }) {
    this.minResultLength = options?.minResultLength ?? 12;
    this.maxRetryAttempts = options?.maxRetryAttempts ?? 2;
  }

  verify(context: VerificationContext): VerificationDecision {
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

function looksWeakResult(text: string): boolean {
  const weakPatterns = [/^ok$/i, /^done$/i, /^success$/i, /^completed$/i];
  return weakPatterns.some((pattern) => pattern.test(text));
}

function looksBlocked(text: string): boolean {
  const blockedPatterns = [/need .*confirm/i, /manual/i, /permission/i];
  return blockedPatterns.some((pattern) => pattern.test(text));
}
