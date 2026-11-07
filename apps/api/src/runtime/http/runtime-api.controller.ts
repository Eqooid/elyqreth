import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { expectedVersion } from '../../agents/agents.service';
import { ApiRequest } from '../../common/http-foundation';
import { RuntimeError } from '../contracts/runtime-error.contract';
import { RuntimeApiGuard } from './runtime-api.guard';
import { RuntimeApiFilter } from './runtime-api.filter';
import { RuntimeApiService } from './runtime-api.service';
import { CancelExecutionDto } from './runtime.dto';

export const HTTP_EXECUTION_TIMEOUT_MS=30000;
@Controller('api/v1/tasks') @UseGuards(RuntimeApiGuard) @UseFilters(RuntimeApiFilter)
export class RuntimeApiController {
  constructor(private readonly runtime:RuntimeApiService) {}
  @Post(':taskId/execute') @HttpCode(200)
  async execute(@Param('taskId',new ParseUUIDPipe()) taskId:string,@Headers('if-match') version:string|undefined,
    @Req() request:ApiRequest,@Res({passthrough:true}) response:Response) {
    const taskVersion=expectedVersion(version),controller=new AbortController();
    const abort=()=>{if(!response.writableFinished)controller.abort(new RuntimeError('CANCELLED'));};
    request.once('aborted',abort);response.once('close',abort);
    const timer=setTimeout(()=>controller.abort(new RuntimeError('DEADLINE_EXCEEDED')),HTTP_EXECUTION_TIMEOUT_MS);
    if(request.aborted||response.destroyed)abort();
    try {return await this.runtime.execute(taskId,taskVersion,controller.signal);}
    finally{clearTimeout(timer);request.removeListener('aborted',abort);response.removeListener('close',abort);}
  }
  @Post(':taskId/executions/:executionId/cancel') @HttpCode(200)
  cancel(@Param('taskId',new ParseUUIDPipe()) taskId:string,@Param('executionId',new ParseUUIDPipe()) executionId:string,
    @Headers('if-match') version:string|undefined,@Body() dto:CancelExecutionDto) {
    return this.runtime.cancel(taskId,executionId,dto.taskVersion,expectedVersion(version));
  }
  @Get(':taskId/status')
  status(@Param('taskId',new ParseUUIDPipe()) taskId:string) {return this.runtime.taskStatus(taskId);}
  @Get(':taskId/executions/:executionId/result')
  result(@Param('taskId',new ParseUUIDPipe()) taskId:string,@Param('executionId',new ParseUUIDPipe()) executionId:string) {
    return this.runtime.result(taskId,executionId);
  }
}
