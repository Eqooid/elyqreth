import 'reflect-metadata';
import { createApplication } from '../application';
import { AuthenticationService } from './auth.service';
async function main(){
 const action=process.argv[2];if(!['create','disable','password','role'].includes(action??''))throw Error();
 // Bounded stdin only: passwords must not be shell arguments or logged by this command.
 process.stdin.setEncoding('utf8');
 let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>4096)throw Error();}
 const input:unknown=JSON.parse(text),app=await createApplication();
 try{await app.init();const result=await app.get(AuthenticationService).provision(input,action as 'create'|'disable'|'password'|'role');process.stdout.write(JSON.stringify(result)+'\n');}
 finally{await app.close();}
}
void main().catch(()=>{process.stderr.write('Local account command failed. Check mode, owner, input, password policy and database.\n');process.exitCode=1;});
