const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {activityReadQuery,timelineCursor,parseTimelineCursor,observationFreshness}=require('../dist/city/collaboration-activity.contract');
test('T09 read queries bound pages filters UUIDs bigint positions and reject unknown fields',()=>{
 assert.equal(activityReadQuery({},['limit']).limit,10);assert.equal(activityReadQuery({limit:'20',authority:'EXTERNAL'},['limit','authority']).authority,'EXTERNAL');
 for(const value of [{limit:'21'},{limit:'0'},{limit:'01'},{ownerId:randomUUID()},{agentId:'bad'},{authority:'native'},{status:'RUNNING'},{afterPosition:'9223372036854775808'},{afterPosition:'-1'},{limit:['1']}])assert.throws(()=>activityReadQuery(value,['limit','agentId','authority','status','afterPosition']),e=>e.status===400);
});
test('T09 timeline cursor retains database microseconds and rejects cross-owner/session reuse and malformed data',()=>{
 const owner=randomUUID(),session=randomUUID(),id='event:'+randomUUID(),time='2026-10-28T00:00:00.123456Z',cursor=timelineCursor(owner,session,time,id);assert.deepEqual(parseTimelineCursor(cursor,owner,session),{time,id});
 for(const args of [[cursor,randomUUID(),session],[cursor,owner,randomUUID()],['bad',owner,session],['x'.repeat(513),owner,session]])assert.throws(()=>parseTimelineCursor(...args),e=>e.status===409);
});
test('T09 freshness means evidence age rather than provider health or fabricated failure',()=>{
 const now=new Date('2026-10-28T00:01:00.000Z');assert.equal(observationFreshness(null,now,true),'UNKNOWN');assert.equal(observationFreshness(now,now,false),'RETIRED');assert.equal(observationFreshness(new Date('2026-10-28T00:00:59Z'),now,true),'RECENT_OBSERVATION');assert.equal(observationFreshness(new Date('2026-10-28T00:00:00Z'),now,true),'STALE');
});
