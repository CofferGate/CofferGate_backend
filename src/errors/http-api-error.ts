import { apiErrorSchema, type ApiError } from "../contracts/index.js";

export interface HttpApiErrorOptions {
  statusCode: number;
  code: string;
  message: string;
  retryable: boolean;
  proposalId?: string;
}

export class HttpApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly proposalId: string | undefined;

  constructor(options: HttpApiErrorOptions) {
    super(options.message);
    this.name = "HttpApiError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.retryable = options.retryable;
    this.proposalId = options.proposalId;
  }

  toResponse(requestId: string): ApiError {
    return apiErrorSchema.parse({
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.proposalId ? { proposalId: this.proposalId } : {}),
      requestId,
    });
  }
}
