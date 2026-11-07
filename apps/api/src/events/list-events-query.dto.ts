import { IsIn, IsString, IsUUID, ValidateBy, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../tasks/dto/task.dto';
import { EventType, eventTypes, validPosition } from './contracts/event-contracts';

export class ListEventsQueryDto extends PaginationQueryDto {
  @ValidateIf((_,value)=>value !== undefined) @IsIn(eventTypes) eventType?: EventType;
  @ValidateIf((_,value)=>value !== undefined) @IsUUID() correlationId?: string;
  @ValidateIf((_,value)=>value !== undefined) @IsString()
  @ValidateBy({name:'eventPosition',validator:{validate:validPosition}}) after?: string;
}
