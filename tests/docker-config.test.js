import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {databaseEnvironment}=createRequire(import.meta.url)('../docker/api-start.cjs');
test('Docker database credentials are URL encoded without modifying source fields or an explicit connection URL',()=>{
 const env={POSTGRES_USER:'local_user',POSTGRES_PASSWORD:'test:@/% $ secret',POSTGRES_DB:'elyqreth'};
 databaseEnvironment(env);const url=new URL(env.DATABASE_URL);
 assert.equal(decodeURIComponent(url.password),env.POSTGRES_PASSWORD);assert.equal(decodeURIComponent(url.username),'local_user');
 assert.equal(url.hostname,'postgres');assert.equal(url.pathname,'/elyqreth');assert.equal(env.DATABASE_SSL_MODE,'disable');
 const explicit={DATABASE_URL:'postgresql://custom:password@db/other',POSTGRES_PASSWORD:'different'};databaseEnvironment(explicit);assert.equal(explicit.DATABASE_URL,'postgresql://custom:password@db/other');
 const empty={};databaseEnvironment(empty);assert.deepEqual(empty,{});
});
