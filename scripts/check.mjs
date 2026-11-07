import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
for(const file of readdirSync('dist/js',{recursive:true}).filter(f=>typeof f==='string'&&f.endsWith('.js'))){const r=spawnSync(process.execPath,['--check',`dist/js/${file}`],{stdio:'inherit'});if(r.status)process.exit(r.status);}
console.log('All game modules passed syntax checks.');
