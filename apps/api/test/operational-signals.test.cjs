const {test}=require('node:test'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{join}=require('node:path');
test('T11 log-derived signal labels remain bounded with arbitrary identifiers, paths and event names',async()=>{
 const {signalSummary}=await import('../../../scripts/operational-signals.mjs');const summary=signalSummary();
 for(let i=0;i<1000;i++){summary.accept(JSON.stringify({event:'http_request',requestId:'private-request-'+i,route:'/private/'+i,statusCode:200,durationMs:15}));summary.accept(JSON.stringify({event:'attacker-'+i}));}
 const output=summary.snapshot(),encoded=JSON.stringify(output);assert.equal(output.http.success,1000);assert.equal(output.unknownEvents,1000);
 assert.ok(Object.keys(output.counts).length<100);assert.ok(!encoded.includes('private-request')&&!encoded.includes('/private/')&&!encoded.includes('attacker-'));
 assert.equal(output.httpLatency.buckets[0].count,1000);assert.equal(output.alerts.length,0);
});
test('T11 local alert fixtures distinguish outage recovery, drain deadlines, ingestion rejection and provider auth failure',async()=>{
 const {signalSummary}=await import('../../../scripts/operational-signals.mjs');const summary=signalSummary();
 summary.accept('{"event":"readiness.changed","dependency":"DATABASE_UNAVAILABLE"}');assert.ok(summary.snapshot().alerts.some(v=>v.condition==='database_readiness_unavailable'));
 summary.accept('{"event":"readiness.changed","dependency":"READY"}');assert.equal(summary.snapshot().alerts.length,0);
 summary.accept('{"event":"runtime.drain.deadline"}');summary.accept('{"event":"external.ingestion.authorization_denied"}');
 for(let i=0;i<3;i++)summary.accept('{"event":"external.operation","outcome":"FAILED","code":"AUTHENTICATION_FAILED"}');
 assert.equal(summary.snapshot().alerts.length,3);assert.equal(summary.snapshot().thresholds,'PROPOSED_NOT_PRODUCTION_BASELINED');
});
test('T11 alert CLI uses deterministic exit status, rejects oversized framing and never emits input payloads',async()=>{
 const run=input=>new Promise((resolve,reject)=>{const child=execFile(process.execPath,[join(__dirname,'../../../scripts/operational-signals.mjs')],{windowsHide:true},(error,stdout,stderr)=>{
  if(error&&typeof error.code!=='number')reject(error);else resolve({code:error?.code??0,body:JSON.parse(stdout),stderr});});child.stdin.end(input);});
 const ok=await run('{"event":"http_request","statusCode":200,"body":"private-document"}\n');assert.equal(ok.code,0);assert.ok(!JSON.stringify(ok).includes('private-document'));
 const outage=await run('x'.repeat(9000)+'\n{"event":"runtime.drain.deadline"}\n');assert.equal(outage.code,2);assert.equal(outage.body.invalidLines,1);assert.equal(outage.body.alerts[0].condition,'runtime_drain_deadline');
});
