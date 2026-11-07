import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsString, IsUUID, Matches, Max, Min, ValidateBy, ValidateIf } from 'class-validator';
import { validTaskInput } from '../tasks/dto/task.dto';

const lower = ({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase() : value;
export class CreateCollaborationDto {
  @Transform(lower) @IsUUID() rootTaskId!: string;
  @Transform(({ value }: { value: unknown }) => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v.toLowerCase() : v) : value)
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(2) @ArrayUnique() @IsUUID(undefined, { each: true }) participantAgentIds!: string[];
  @IsString() @Matches(/^[A-Za-z0-9._:-]{1,128}$/) idempotencyKey!: string;
}
export class RequestDelegationDto {
  @Transform(lower) @IsUUID() sourceAgentId!: string;
  @Transform(lower) @IsUUID() targetAgentId!: string;
  @Transform(lower) @IsUUID() parentTaskId!: string;
  @Transform(lower) @IsUUID() sourceExecutionId!: string;
  @IsString() @Matches(/^[A-Za-z0-9._:-]{1,128}$/) idempotencyKey!: string;
}
export class CollaborationPageDto {
  @ValidateIf((_, v) => v !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^\d{1,2}$/.test(value) ? Number(value) : value)
  @IsInt() @Min(1) @Max(20) limit?: number;
  @ValidateIf((_, v) => v !== undefined) @Transform(lower) @IsUUID() after?: string;
}
export class CollaborationLookupDto {
  @IsString() @Matches(/^[A-Za-z0-9._:-]{1,128}$/) idempotencyKey!: string;
}
export class ActivateDelegationDto {
  @IsString() @ValidateBy({ name: 'delegationInstruction', validator: { validate: value => validTaskInput({ instruction: value }) } }) instruction!: string;
  @IsString() @Matches(/^[A-Za-z0-9._:-]{1,128}$/) idempotencyKey!: string;
}
