import {TileMap} from '../dist/js/tile-map.js';
import {validateCity} from '../dist/js/city-validation.js';

const report=validateCity(new TileMap());
console.log(JSON.stringify(report,null,2));
if(!report.valid)process.exitCode=1;
