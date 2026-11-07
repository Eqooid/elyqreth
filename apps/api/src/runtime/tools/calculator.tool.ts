import { Injectable } from '@nestjs/common';
import { ToolExecutionContext, ToolHandler } from '../contracts/tool.contract';
import { RuntimeError } from '../contracts/runtime-error.contract';
import { record } from '../contracts/validation';
import { assertToolActive } from './tool-deadline';

type Input={readonly operation:'add'|'subtract'|'multiply'|'divide';readonly a:number;readonly b:number};
type Output={readonly result:number};
@Injectable()
export class CalculatorTool implements ToolHandler<Input,Output> {
  readonly definition=Object.freeze({id:'calculator',version:1,requiredCapability:'tool.calculator.v1' as const,
    inputSchemaId:'calculator.input.v1',outputSchemaId:'calculator.output.v1',maxInputBytes:1024,maxOutputBytes:1024,timeoutMs:1000});
  parseInput(value:unknown):Input {
    const p=record(value,['operation','a','b'],'tool');
    if(!['add','subtract','multiply','divide'].includes(p.operation as string)||[p.a,p.b].some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>1000000)||
      p.operation==='divide'&&p.b===0)throw new RuntimeError('INVALID_INPUT','tool');
    return Object.freeze({operation:p.operation as Input['operation'],a:p.a as number,b:p.b as number});
  }
  parseOutput(value:unknown):Output {
    const p=record(value,['result'],'tool');
    if(typeof p.result!=='number'||!Number.isFinite(p.result)||Math.abs(p.result)>1000000000000)throw new RuntimeError('TOOL_FAILED','tool');
    return Object.freeze({result:Object.is(p.result,-0)?0:p.result});
  }
  async execute(input:Input,context:ToolExecutionContext):Promise<Output> {
    assertToolActive(context);const p=this.parseInput(input);
    const result=p.operation==='add'?p.a+p.b:p.operation==='subtract'?p.a-p.b:p.operation==='multiply'?p.a*p.b:p.a/p.b;
    if(!Number.isFinite(result)||Math.abs(result)>1000000000000)throw new RuntimeError('INVALID_INPUT','tool');
    assertToolActive(context);return this.parseOutput({result});
  }
}
