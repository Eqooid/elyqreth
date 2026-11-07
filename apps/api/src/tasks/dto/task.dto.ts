import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsString, IsUUID, Matches, Max, Min, ValidateBy, ValidateIf } from 'class-validator';

const optional = (_: unknown, value: unknown) => value !== undefined;
export interface TaskInput { instruction: string; context?: string }

export function validTaskInput(value: unknown): value is TaskInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) return false;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['instruction', 'context'].includes(key))) return false;
  if (typeof input.instruction !== 'string' || !input.instruction.trim() || input.instruction.length > 16000) return false;
  if (input.context !== undefined && (typeof input.context !== 'string' || input.context.length > 16000)) return false;
  // Defense in depth for common credential material; this is not a general DLP guarantee.
  const text = `${input.instruction}\n${input.context ?? ''}`;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) return false;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]{8,}|\bsk-[A-Za-z0-9_-]{16,}|\b(?:api[_ -]?key|password|access[_ -]?token|secret)\s*[:=]\s*\S+|\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s/:]+:[^\s/@]+@/i.test(text)) return false;
  return Buffer.byteLength(JSON.stringify(input), 'utf8') <= 32768;
}

export class CreateTaskDto {
  @IsUUID() agentId!: string;
  @ValidateBy({ name: 'safeTaskInput', validator: { validate: validTaskInput } }) input!: TaskInput;
  @ValidateIf(optional) @IsString() @Matches(/^[A-Za-z0-9._:-]{1,128}$/)
  idempotencyKey?: string;
}

export class PaginationQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset = 0;
}

export class ListTasksQueryDto extends PaginationQueryDto {
  @ValidateIf(optional) @IsIn(['CREATED','QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED'])
  status?: 'CREATED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  @ValidateIf(optional) @IsUUID() agentId?: string;
  @ValidateIf(optional) @IsUUID() orchestratorId?: string;
  @ValidateIf(optional) @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^[1-9]\d{3}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/)
  createdFrom?: string;
  @ValidateIf(optional) @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^[1-9]\d{3}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/)
  createdTo?: string;
}
