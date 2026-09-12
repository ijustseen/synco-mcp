export class AppError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly httpStatus: number;

  constructor(code: string, message: string, details?: unknown, httpStatus = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
  }

  toJSON(): { code: string; message: string; details?: unknown } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export const ErrorCodes = {
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  TASK_NOT_FOUND: "TASK_NOT_FOUND",
  TASK_ALREADY_CLAIMED: "TASK_ALREADY_CLAIMED",
  TASK_NOT_ASSIGNED: "TASK_NOT_ASSIGNED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
} as const;
