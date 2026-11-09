import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('verification executes on a supported patched Node runtime',()=>{
  const [major,minor,patch]=process.versions.node.split('.').map(Number);
  assert.ok(major===24&&(minor>22||minor===22&&patch>=2),
    `Use Node 24.22.2 or newer within 24.x; running ${process.version}`);
});

test('development, workspace engines, lock metadata and container builds retain the patched Node 24 baseline',()=>{
  const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
  const selected=read('.node-version').trim();
  const [major,minor,patch]=selected.split('.').map(Number);
  assert.equal(major,24);
  assert.ok(minor>22||minor===22&&patch>=1,'CVE-2026-111497 requires Node 24.22.1 or newer');
  const engine=`>=${selected} <25`,lock=JSON.parse(read('package-lock.json'));
  for(const name of ['', 'apps/api']){
    const manifest=JSON.parse(read(name?name+'/package.json':'package.json'));
    assert.equal(manifest.engines.node,engine);
    assert.equal(lock.packages[name].engines.node,engine);
  }
  const images=[...read('Dockerfile').matchAll(/^FROM node:(\S+) AS (\S+)$/gm)];
  assert.deepEqual(images.map(match=>match[2]),['api-build','api']);
  for(const match of images)assert.match(match[1],new RegExp('^'+selected.replaceAll('.','\\.')+'-alpine@sha256:[a-f0-9]{64}$'));
  for(const workflow of ['verify','release-candidate','promotion-plan'])
    assert.match(read(`.github/workflows/${workflow}.yml`),/node-version-file: \.node-version/);
});
