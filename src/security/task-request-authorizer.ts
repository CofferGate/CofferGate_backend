import { timingSafeEqual } from "node:crypto";

export interface TaskRequestAuthorizer {
  authorize(token: string | undefined): boolean;
}

export class TaskTokenAuthorizer implements TaskRequestAuthorizer {
  private readonly expected: Buffer;

  constructor(token: string) {
    if (!token) throw new Error("Internal task token must not be empty.");
    this.expected = Buffer.from(token);
  }

  authorize(token: string | undefined): boolean {
    if (!token) return false;
    const provided = Buffer.from(token);
    return (
      provided.length === this.expected.length &&
      timingSafeEqual(provided, this.expected)
    );
  }
}
