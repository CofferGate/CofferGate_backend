import { encodeBase58 } from "../encoding/base58.js";
import { inspectUnsignedVersionedTransaction } from "../providers/jupiter-swap.js";

export class SolanaProgramAllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolanaProgramAllowlistError";
  }
}

export class SolanaProgramAllowlistValidator {
  validate(transaction: Buffer, allowedPrograms: readonly string[]): string[] {
    const message = inspectUnsignedVersionedTransaction(transaction).message;
    const reader = new MessageReader(message);
    const version = reader.byte();
    if (version !== 0x80) throw new SolanaProgramAllowlistError("Only version 0 messages are supported.");
    reader.skip(3);
    const staticAccountCount = reader.shortVector();
    const staticAccounts = Array.from({ length: staticAccountCount }, () => reader.bytes(32));
    reader.skip(32);
    const instructionCount = reader.shortVector();
    const programIds = new Set<string>();
    for (let index = 0; index < instructionCount; index += 1) {
      const programIndex = reader.byte();
      const accountCount = reader.shortVector();
      reader.skip(accountCount);
      const dataLength = reader.shortVector();
      reader.skip(dataLength);
      const programKey = staticAccounts[programIndex];
      if (!programKey) {
        throw new SolanaProgramAllowlistError("Lookup-table program IDs are not allowed.");
      }
      programIds.add(encodeBase58(programKey));
    }
    const lookupCount = reader.shortVector();
    for (let index = 0; index < lookupCount; index += 1) {
      reader.skip(32);
      reader.skip(reader.shortVector());
      reader.skip(reader.shortVector());
    }
    reader.finish();
    const allowed = new Set(allowedPrograms);
    const denied = [...programIds].filter((programId) => !allowed.has(programId));
    if (denied.length > 0) {
      throw new SolanaProgramAllowlistError(`Transaction uses a non-allowlisted program: ${denied[0]}.`);
    }
    return [...programIds];
  }
}

class MessageReader {
  private offset = 0;
  constructor(private readonly message: Buffer) {}

  byte(): number {
    if (this.offset >= this.message.length) this.invalid();
    return this.message[this.offset++]!;
  }

  bytes(length: number): Buffer {
    const start = this.offset;
    this.skip(length);
    return this.message.subarray(start, this.offset);
  }

  skip(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.message.length) this.invalid();
    this.offset += length;
  }

  shortVector(): number {
    let value = 0;
    let shift = 0;
    for (let index = 0; index < 3; index += 1) {
      const byte = this.byte();
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
    }
    this.invalid();
  }

  finish(): void {
    if (this.offset !== this.message.length) this.invalid();
  }

  private invalid(): never {
    throw new SolanaProgramAllowlistError("Versioned transaction message is malformed.");
  }
}
