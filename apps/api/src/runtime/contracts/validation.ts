import { isUUID } from 'class-validator';
import { RuntimeError, RuntimeStage } from './runtime-error.contract';

export function invalid(stage: RuntimeStage): never { throw new RuntimeError('INVALID_INPUT', stage); }

// Reject getters, custom prototypes, symbols and non-enumerable hidden input.
// Validators construct new objects, rather than serializing attacker objects.
export function record(value: unknown, allowed: readonly string[], stage: RuntimeStage): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) return invalid(stage);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) return invalid(stage);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return invalid(stage);
  }
  return value as Record<string, unknown>;
}
export function integer(value: unknown, min: number, max: number, stage: RuntimeStage): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalid(stage);
  return value;
}
export function identifier(value: unknown, stage: RuntimeStage): string {
  if (typeof value !== 'string' || !isUUID(value)) return invalid(stage);
  return value.toLowerCase();
}
export function token(value: unknown, stage: RuntimeStage): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/.test(value)) return invalid(stage);
  return value;
}
export function modelIdentifier(value: unknown, stage: RuntimeStage): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value) || value.includes('://') || /^sk-/i.test(value)) return invalid(stage);
  return value;
}
export function capabilities(value: unknown, stage: RuntimeStage): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 32 ||
    Reflect.ownKeys(value).length !== value.length + 1) return invalid(stage);
  const normalized: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || typeof descriptor.value !== 'string') return invalid(stage);
    const capability: string = descriptor.value.trim();
    if (!/^tool\.[a-z][a-z0-9_.-]{0,58}$/.test(capability)) return invalid(stage);
    normalized.push(capability);
  }
  return Object.freeze([...new Set(normalized)].sort());
}
export function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }

export function safeText(value: unknown, stage: RuntimeStage): string {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]{8,}|\bsk-[A-Za-z0-9_-]{16,}|\b(?:api[_ -]?key|password|access[_ -]?token|secret)\s*[:=]\s*\S+|\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s/:]+:[^\s/@]+@/i.test(value)) return invalid(stage);
  return value;
}
