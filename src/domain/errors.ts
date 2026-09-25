/** Thrown by the domain module on programmer errors (non-integers, out-of-range inputs). */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export function assertSafeInt(value: number, name: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new DomainError(`${name} must be a safe integer, got ${String(value)}`);
  }
  return value;
}

export function assertNonNegativeInt(value: number, name: string): number {
  assertSafeInt(value, name);
  if (value < 0) throw new DomainError(`${name} must be >= 0, got ${value}`);
  return value;
}

export function assertPositiveInt(value: number, name: string): number {
  assertSafeInt(value, name);
  if (value < 1) throw new DomainError(`${name} must be >= 1, got ${value}`);
  return value;
}
