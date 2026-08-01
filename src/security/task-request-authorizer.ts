import { timingSafeEqual } from "node:crypto";

export interface TaskRequestAuthorizer {
  authorize(authorization: string | undefined): boolean;
}

export class BearerTaskRequestAuthorizer implements TaskRequestAuthorizer {
  private readonly expected: Buffer;

  constructor(token: string) {
    if (!token) throw new Error("Internal task token must not be empty.");
    this.expected = Buffer.from(`Bearer ${token}`);
  }

  authorize(authorization: string | undefined): boolean {
    if (!authorization) return false;
    const provided = Buffer.from(authorization);
    return (
      provided.length === this.expected.length &&
      timingSafeEqual(provided, this.expected)
    );
  }
}
