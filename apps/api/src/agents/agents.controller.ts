import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AgentsService, expectedVersion } from './agents.service';
import { CreateAgentDto, ListAgentsQueryDto, UpdateAgentDto } from './dto/agent.dto';
import { RegistryGuard } from './registry.guard';
import { AgentActivityProjectionService } from '../city/activity.service';

function emptyCommand(body: unknown): void {
  if (body === undefined) return;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new BadRequestException();
}

@Controller('api/v1/agents')
@UseGuards(RegistryGuard)
export class AgentsController {
  constructor(private readonly agents: AgentsService,private readonly activity:AgentActivityProjectionService) {}
  @Post() create(@Body() dto: CreateAgentDto) { return this.agents.create(dto); }
  @Get() list(@Query() query: ListAgentsQueryDto) { return this.agents.list(query); }
  // Static route must precede :id so 'activities' is never parsed as a UUID.
  @Get('activities') activities(@Query() query:unknown) {return this.activity.batch(query);}
  @Get(':id/activity') activityFor(@Param('id',new ParseUUIDPipe()) id:string,@Query() query:Record<string,unknown>) {
    if(Object.keys(query).length)throw new BadRequestException();return this.activity.single(id);
  }
  @Get(':id') get(@Param('id', new ParseUUIDPipe()) id: string) { return this.agents.get(id); }
  @Patch(':id') update(@Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAgentDto, @Headers('if-match') version?: string) {
    return this.agents.update(id, dto, expectedVersion(version));
  }
  @Post(':id/activate') @HttpCode(200)
  activate(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Headers('if-match') version?: string) { emptyCommand(body); return this.agents.lifecycle(id, 'ACTIVE', expectedVersion(version)); }
  @Post(':id/disable') @HttpCode(200)
  disable(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Headers('if-match') version?: string) { emptyCommand(body); return this.agents.lifecycle(id, 'DISABLED', expectedVersion(version)); }
  @Post(':id/archive') @HttpCode(200)
  archive(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Headers('if-match') version?: string) { emptyCommand(body); return this.agents.lifecycle(id, 'ARCHIVED', expectedVersion(version)); }
}
