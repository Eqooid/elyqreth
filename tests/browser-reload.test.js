import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {reloadCity} from '../scripts/browser-reload.mjs';

test('reload waits for the new document and rendered Agent controls, even when the old page is ready',async()=>{
  let loaded,documentLoaded=false,polls=0;
  const events=[];
  await reloadCity({
    waitEvent:method=>{events.push(method);return new Promise(resolve=>{loaded=()=>{documentLoaded=true;resolve();};});},
    command:async method=>{events.push(method);setImmediate(loaded);},
    evaluate:async expression=>{
      assert.equal(documentLoaded,true,'Old document must never satisfy readiness');
      const phase=polls++;
      return vm.runInNewContext(expression,{document:{
        getElementById:()=>phase===0?null:{textContent:'{"agents":[]}'},
        querySelector:selector=>{assert.equal(selector,'#agent-list [data-agent]');return phase>=2?{}:null;},
      }});
    },
    until:async predicate=>{for(let i=0;i<3;i++)if(await predicate())return;assert.fail('New Agent controls never became ready');},
  });
  assert.deepEqual(events,['Page.loadEventFired','Page.reload']);
  assert.equal(polls,3);
});

test('reload propagates navigation and DOM readiness failures',async()=>{
  for(const stage of ['load','DOM']){
    const failure=new Error(stage+' deadline');
    await assert.rejects(reloadCity({
      waitEvent:()=>stage==='load'?Promise.reject(failure):Promise.resolve(),
      command:async()=>{},evaluate:async()=>false,
      until:async()=>{throw failure;},
    }),error=>error===failure);
  }
});
