import {existsSync,realpathSync} from 'node:fs';
import {resolve,relative,dirname,isAbsolute,sep} from 'node:path';

export function newOutsideOutput(root,candidate){
 const output=resolve(candidate),parent=realpathSync(dirname(output)),part=relative(realpathSync(root),parent);
 const outside=isAbsolute(part)||part==='..'||part.startsWith('..'+sep);
 if(existsSync(output)||!outside)throw Error('Use a new evidence directory outside the checkout.');
 return output;
}
