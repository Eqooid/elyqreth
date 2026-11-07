import { Inject, Injectable } from '@nestjs/common';
import { ToolExecutionContext, ToolHandler } from '../contracts/tool.contract';
import { RuntimeError } from '../contracts/runtime-error.contract';
import { record } from '../contracts/validation';
import { TOOL_CLOCK } from '../tokens/runtime.tokens';
import { assertToolActive } from './tool-deadline';

type Output={readonly iso8601:string;readonly timezone:'UTC'};
@Injectable()
export class CurrentDatetimeTool implements ToolHandler<Readonly<Record<string,never>>,Output> {
  readonly definition=Object.freeze({id:'current_datetime',version:1,requiredCapability:'tool.current_datetime.v1' as const,
    inputSchemaId:'current_datetime.input.v1',outputSchemaId:'current_datetime.output.v1',maxInputBytes:1024,maxOutputBytes:1024,timeoutMs:1000});
  constructor(@Inject(TOOL_CLOCK) private readonly clock:()=>number) {}
  parseInput(value:unknown):Readonly<Record<string,never>> {record(value,[],'tool');return Object.freeze({});}
  parseOutput(value:unknown):Output {
    const p=record(value,['iso8601','timezone'],'tool');
    if(typeof p.iso8601!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p.iso8601)||
      !Number.isFinite(Date.parse(p.iso8601))||new Date(p.iso8601).toISOString()!==p.iso8601||p.timezone!=='UTC')throw new RuntimeError('TOOL_FAILED','tool');
    return Object.freeze({iso8601:p.iso8601,timezone:'UTC'});
  }
  async execute(input:Readonly<Record<string,never>>,context:ToolExecutionContext):Promise<Output> {
    assertToolActive(context);this.parseInput(input);
    const now=this.clock();if(typeof now!=='number'||!Number.isSafeInteger(now))throw new RuntimeError('TOOL_FAILED','tool');
    const result=this.parseOutput({iso8601:new Date(now).toISOString(),timezone:'UTC'});assertToolActive(context);return result;
  }
}
