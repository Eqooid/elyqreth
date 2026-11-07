import { Inject, Injectable } from '@nestjs/common';
import { ToolDefinition, ToolHandler } from '../contracts/tool.contract';
import { RuntimeError } from '../contracts/runtime-error.contract';
import { integer, record, token } from '../contracts/validation';
import { TOOL_HANDLERS } from '../tokens/runtime.tokens';

@Injectable()
export class ToolRegistry {
  readonly #tools=new Map<string,ToolHandler>();
  constructor(@Inject(TOOL_HANDLERS) handlers:readonly ToolHandler[]) {for(const handler of handlers)this.register(handler);}
  register(handler:ToolHandler):void {
    try {
      const d=record(handler?.definition,['id','version','requiredCapability','inputSchemaId','outputSchemaId','maxInputBytes','maxOutputBytes','timeoutMs'],'tool');
      const id=token(d.id,'tool'),version=integer(d.version,1,1000,'tool');
      if(d.requiredCapability!==`tool.${id}.v${version}`||typeof handler.execute!=='function'||
        typeof handler.parseInput!=='function'||typeof handler.parseOutput!=='function'||this.#tools.has(id))throw new Error();
      const definition:ToolDefinition=Object.freeze({id,version,requiredCapability:d.requiredCapability as ToolDefinition['requiredCapability'],
        inputSchemaId:token(d.inputSchemaId,'tool'),outputSchemaId:token(d.outputSchemaId,'tool'),
        maxInputBytes:integer(d.maxInputBytes,1,1024,'tool'),maxOutputBytes:integer(d.maxOutputBytes,1,1024,'tool'),
        timeoutMs:integer(d.timeoutMs,1,2000,'tool')});
      this.#tools.set(id,Object.freeze({definition,parseInput:handler.parseInput.bind(handler),parseOutput:handler.parseOutput.bind(handler),execute:handler.execute.bind(handler)}));
    }catch{throw new RuntimeError('CONFIGURATION_ERROR','tool');}
  }
  resolve(id:string,version:number):ToolHandler {
    token(id,'tool');integer(version,1,1000,'tool');
    const handler=this.#tools.get(id);
    if(!handler||handler.definition.version!==version)throw new RuntimeError('TOOL_DENIED','tool');
    return handler;
  }
  listDefinitions():readonly ToolDefinition[] {return Object.freeze([...this.#tools.values()].map(t=>t.definition).sort((a,b)=>a.id.localeCompare(b.id,'en')));}
}
