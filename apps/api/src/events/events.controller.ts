import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventHistoryGuard } from './event-history.guard';
import { ListEventsQueryDto } from './list-events-query.dto';

@Controller('api/v1') @UseGuards(EventHistoryGuard)
export class EventsController {
  constructor(private readonly events:EventsService) {}
  @Get('agents/:id/events') agents(@Param('id',new ParseUUIDPipe()) id:string,@Query() query:ListEventsQueryDto) {return this.events.history('agent',id,query);}
  @Get('tasks/:id/events') tasks(@Param('id',new ParseUUIDPipe()) id:string,@Query() query:ListEventsQueryDto) {return this.events.history('task',id,query);}
  @Get('executions/:id/events') executions(@Param('id',new ParseUUIDPipe()) id:string,@Query() query:ListEventsQueryDto) {return this.events.history('execution',id,query);}
}
