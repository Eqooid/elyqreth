const {createApplication}=require('../../dist/application');
const {validateEnvironment}=require('../../dist/config/configuration');
const {ApiLogger}=require('../../dist/common/api-logger');
void (async()=>{
 const app=await createApplication(validateEnvironment({NODE_ENV:'test'}));
 app.get(ApiLogger).info=()=>{};app.get(ApiLogger).error=()=>{};
 app.use((error,req,res,next)=>{process.send({parser:{type:error.type,code:error.code,status:error.status}});next(error);});
 await app.listen(0,'127.0.0.1');
 process.send({port:app.getHttpServer().address().port});
 process.on('message',async message=>{if(message==='stop'){await app.close();process.exit(0);}});
})().catch(()=>process.exit(1));
