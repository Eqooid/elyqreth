import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsHexColor, IsIn, IsInt, IsObject, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

export const agentTypes = ['RULE_BASED', 'LLM', 'EXTERNAL'] as const;
export const agentStatuses = ['ACTIVE', 'DISABLED', 'ARCHIVED'] as const;
const optional = (_: unknown, value: unknown) => value !== undefined;
const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

// Deliberately narrow metadata, not runtime/provider configuration or arbitrary JSON.
export class AgentMetadataDto {
  @ValidateIf(optional) @IsIn(['general', 'research', 'design', 'build', 'test'])
  category?: string;

  @ValidateIf(optional) @IsHexColor()
  color?: string;
}

export class CreateAgentDto {
  @Transform(trim) @IsString() @Length(1, 160) @Matches(/^[^\u0000-\u001f\u007f]+$/u)
  name!: string;

  @ValidateIf((_, value) => value !== undefined && value !== null) @IsString() @MaxLength(4000)
  description?: string | null;

  @IsIn(agentTypes) type!: typeof agentTypes[number];
  @IsUUID() orchestratorId!: string;

  @ValidateIf(optional) @IsArray() @ArrayMaxSize(32) @ArrayUnique()
  @IsString({ each: true }) @Matches(/^[a-z][a-z0-9_.-]{0,63}$/, { each: true })
  capabilities?: string[];

  @ValidateIf(optional) @IsObject() @ValidateNested() @Type(() => AgentMetadataDto)
  configuration?: AgentMetadataDto;
}

export class UpdateAgentDto {
  @ValidateIf(optional) @Transform(trim) @IsString() @Length(1, 160) @Matches(/^[^\u0000-\u001f\u007f]+$/u)
  name?: string;

  @ValidateIf((_, value) => value !== undefined && value !== null) @IsString() @MaxLength(4000)
  description?: string | null;

  @ValidateIf(optional) @IsArray() @ArrayMaxSize(32) @ArrayUnique()
  @IsString({ each: true }) @Matches(/^[a-z][a-z0-9_.-]{0,63}$/, { each: true })
  capabilities?: string[];

  @ValidateIf(optional) @IsObject() @ValidateNested() @Type(() => AgentMetadataDto)
  configuration?: AgentMetadataDto;
}

export class ListAgentsQueryDto {
  @ValidateIf(optional) @IsIn(agentStatuses) status?: typeof agentStatuses[number];
  @ValidateIf(optional) @IsIn(agentTypes) type?: typeof agentTypes[number];
  @ValidateIf(optional) @IsUUID() orchestratorId?: string;
  @ValidateIf(optional) @IsString() @Length(1, 160) search?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset = 0;
}

