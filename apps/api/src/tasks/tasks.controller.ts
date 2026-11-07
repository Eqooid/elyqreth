import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CreateTaskDto, ListTasksQueryDto } from './dto/task.dto';
import { TaskRequestGuard } from './task-request.guard';
import { TasksService } from './tasks.service';

@Controller('api/v1/tasks')
@UseGuards(TaskRequestGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}
  @Post()
  async create(@Body() dto: CreateTaskDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.tasks.create(dto);
    response.status(result.created ? 201 : 200);
    return result.task;
  }
  @Get() list(@Query() query: ListTasksQueryDto) { return this.tasks.list(query); }
  @Get(':id') get(@Param('id', new ParseUUIDPipe()) id: string) { return this.tasks.get(id); }
}
