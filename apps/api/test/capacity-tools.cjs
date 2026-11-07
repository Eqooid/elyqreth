const {performance}=require('node:perf_hooks');
function statistics(values){
 if(!values.length)return {samples:0,p50Ms:null,p95Ms:null,maxMs:null};
 const ordered=[...values].sort((a,b)=>a-b),pick=p=>ordered[Math.max(0,Math.ceil(p*ordered.length)-1)];
 return {samples:values.length,p50Ms:pick(.5),p95Ms:pick(.95),maxMs:ordered.at(-1)};
}
async function boundedStage({name,count,concurrency,operation,allowed=[200],sample=()=>({}),deadlineMs=20000,rssLimit=768*1024*1024}){
 if(!Number.isInteger(count)||count<1||count>64||!Number.isInteger(concurrency)||concurrency<1||concurrency>8||!Number.isInteger(deadlineMs)||deadlineMs<1||deadlineMs>20000||!Number.isInteger(rssLimit)||rssLimit<1||rssLimit>768*1024*1024)throw Error('Invalid bounded capacity workload');
 const begin=performance.now(),cpu=process.cpuUsage(),startedAt=new Date().toISOString(),latencies=[],successful=[],statuses={};let next=0,stopped=false,inflight=0,peakConcurrent=0,maxWaiting=0,maxPool=0,peakRss=process.memoryUsage().rss;
 const observe=()=>{const d=sample();maxWaiting=Math.max(maxWaiting,d.waiting??0);maxPool=Math.max(maxPool,d.total??0);peakRss=Math.max(peakRss,process.memoryUsage().rss);if(peakRss>rssLimit||performance.now()-begin>deadlineMs)stopped=true;};
 const timer=setInterval(observe,10);
 try{await Promise.all(Array.from({length:concurrency},async()=>{while(!stopped){const index=next++;if(index>=count)return;observe();if(stopped)return;const t=performance.now();inflight++;peakConcurrent=Math.max(peakConcurrent,inflight);let status;
 try{status=await operation(index);}catch{status='TRANSPORT_ERROR';}finally{inflight--;}
 const duration=performance.now()-t;latencies.push(duration);statuses[status]=(statuses[status]??0)+1;if(typeof status==='number'&&status>=200&&status<300)successful.push(duration);if(!allowed.includes(status))stopped=true;
 }}));}finally{clearInterval(timer);observe();}
 const elapsed=performance.now()-begin,usage=process.cpuUsage(cpu);
 return {name,startedAt,finishedAt:new Date().toISOString(),requested:count,completed:latencies.length,concurrency,peakConcurrent,statuses,elapsedMs:elapsed,requestsPerSecond:latencies.length/(elapsed/1000),successfulRequestsPerSecond:successful.length/(elapsed/1000),latency:statistics(latencies),acceptedLatency:statistics(successful),cpuCorePercent:(usage.user+usage.system)/(elapsed*1000)*100,peakRssBytes:peakRss,maxPoolConnections:maxPool,maxPoolWaiting:maxWaiting,stopped,status:!stopped&&latencies.length===count?'PASS':'FAIL'};
}
module.exports={statistics,boundedStage};
