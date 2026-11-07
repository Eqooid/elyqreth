import { isDeepStrictEqual } from 'node:util';
import { AuthorizedToolDescription } from './provider.contract';
import { RuntimeError } from './runtime-error.contract';
import { record } from './validation';
import { toolValue } from '../tools/tool-validation';

function deepFreeze<T>(value:T):T {
  if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;
}
const descriptions:readonly AuthorizedToolDescription[]=deepFreeze([
  {toolId:'calculator',version:1,inputSchemaId:'calculator.input.v1',outputSchemaId:'calculator.output.v1',
    description:'Perform bounded arithmetic on two finite numbers.',inputSchema:{type:'object',additionalProperties:false,
      properties:{operation:{type:'string',enum:['add','subtract','multiply','divide']},a:{type:'number',minimum:-1000000,maximum:1000000},b:{type:'number',minimum:-1000000,maximum:1000000}},required:['operation','a','b']}},
  {toolId:'current_datetime',version:1,inputSchemaId:'current_datetime.input.v1',outputSchemaId:'current_datetime.output.v1',
    description:'Read the current server time in UTC.',inputSchema:{type:'object',properties:{},required:[],additionalProperties:false}},
]);
export function modelToolDescription(toolId:string,version:number):AuthorizedToolDescription {
  const description=descriptions.find(d=>d.toolId===toolId&&d.version===version);
  if(!description)throw new RuntimeError('TOOL_DENIED','tool');return description;
}
export function validateToolDescription(value:unknown):AuthorizedToolDescription {
  const d=record(value,['toolId','version','inputSchemaId','outputSchemaId','description','inputSchema'],'provider');
  const expected=modelToolDescription(d.toolId as string,d.version as number);
  if(!isDeepStrictEqual({...d,inputSchema:toolValue(d.inputSchema,1024)},expected))throw new RuntimeError('INVALID_INPUT','provider');return expected;
}
