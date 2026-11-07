import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../dist/js/simulation.js';
import {NPC_IDS,NPC_MANIFEST_VERSION,validNpcId} from '../dist/js/npc-identity.js';
import {readFileSync} from 'node:fs';

test('stable NPC slots survive new city instances, rename, motion and reset without replacing numeric movement IDs',()=>{
 const a=new Simulation(),b=new Simulation();
 assert.equal(NPC_MANIFEST_VERSION,1);assert.equal(NPC_IDS.length,20);assert.ok(Object.isFrozen(NPC_IDS));
 assert.deepEqual(a.agents.map(x=>x.npcId),NPC_IDS.slice(0,4));assert.deepEqual(b.agents.map(x=>x.npcId),NPC_IDS.slice(0,4));
 assert.deepEqual(a.agents.map(x=>x.id),[1,2,3,4]);
 a.agents[0].name='Different';for(let i=0;i<20;i++)a.update(1/30);a.reset(false);
 assert.equal(a.agents[0].npcId,NPC_IDS[0]);assert.throws(()=>{a.agents[0].npcId=NPC_IDS[1];},TypeError);
 assert.equal(validNpcId('Ada'),false);assert.equal(validNpcId(1),false);
});
test('local additions remain unbound; explicit duplicate slots reject without spawning or changing IDs',()=>{
 const s=new Simulation(),template=s.agents[0];const a=s.addAgent('Ada',template.role,template.workplace,false);
 assert.ok(a);assert.equal(a.npcId,null);
 const base=s.agents[0],count=s.agents.length,next=s.nextId;
 assert.equal(s.addAgent('Duplicate',base.role,base.workplace,false,undefined,base.appearance,base.npcId),null);
 assert.equal(s.addAgent('Invalid',base.role,base.workplace,false,undefined,base.appearance,'9999'),null);
 assert.equal(s.agents.length,count);assert.equal(s.nextId,next);
 s.removeAgent(base.id);assert.equal(s.agents.some(x=>x.npcId===base.npcId),false);
 s.update(1/30);assert.equal(s.agents.some(x=>x.npcId===base.npcId),false);
});
test('frontend/backend slot catalogs agree without backend imports, provider coupling or network hydration',()=>{
 const backend=readFileSync(new URL('../apps/api/src/city/binding.contract.ts',import.meta.url),'utf8');
 assert.match(backend,/length:20/);assert.match(backend,/resident-slot-/);
 const source=readFileSync(new URL('../dist/js/npc-identity.js',import.meta.url),'utf8');
 assert.ok(!/fetch\(|localStorage|provider|runtime-coordinator/.test(source));
});
