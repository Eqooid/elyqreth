import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { PaginationQueryDto } from '../tasks/dto/task.dto';
import { ExecutionReadGuard } from './execution-read.guard';
import { ExecutionsService } from './executions.service';

@Controller('api/v1/tasks/:taskId/executions')
@UseGuards(ExecutionReadGuard)
export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}
  @Get()
  list(@Param('taskId', new ParseUUIDPipe()) taskId: string, @Query() query: PaginationQueryDto) {
    return this.executions.list(taskId, query);
  }
  @Get(':executionId')
  get(@Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Param('executionId', new ParseUUIDPipe()) executionId: string) {
    return this.executions.get(taskId, executionId);
  }
}
