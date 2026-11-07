import {test} from 'node:test';
import assert from 'node:assert/strict';
import {THEME,icePixel,themeAtlas,CHARACTER_ATLASES,visualAccent,atlasColorRole,BUILDING_PALETTES,visualRoleColor} from '../dist/js/theme.js';
const luminance=rgb=>rgb.reduce((v,c,i)=>v+c*[.2126,.7152,.0722][i],0);
test('light ramps retain readable shading and preserve green/pink material accents',()=>{
 const ramp=[[36,19,7],[110,65,20],[210,125,35],[255,225,165]].map(c=>icePixel(...c));
 for(let i=0;i<ramp.length;i++){assert.ok(ramp[i][2]>ramp[i][0]);if(i)assert.ok(luminance(ramp[i])>luminance(ramp[i-1]));}
 assert.deepEqual(icePixel(52,100,34),[52,100,34]);assert.deepEqual(icePixel(242,78,183),[242,78,183]);assert.equal(visualAccent('#ff9a36'),THEME.primary);assert.equal(visualAccent('#ff85ca'),'#ff85ca');
});
test('atlas conversion keeps alpha, transparent gutters, source dimensions and character art intact',()=>{
 const prior=globalThis.document,pixels=new Uint8ClampedArray([255,160,24,255,220,100,10,64,33,60,77,0,242,78,183,255]);
 let output,layer={width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({data:pixels}),putImageData:d=>{output=d.data;}})};
 globalThis.document={createElement:()=>layer};try{
  const source={width:2,height:2};assert.equal(themeAtlas(source,'buildings'),layer);assert.equal(layer.width,2);assert.equal(layer.height,2);assert.deepEqual([output[3],output[7],output[11],output[15]],[255,64,0,255]);assert.deepEqual([...output.slice(8,12)],[33,60,77,0]);assert.deepEqual([...output.slice(12,15)],[242,78,183]);
  for(const atlas of CHARACTER_ATLASES)assert.equal(themeAtlas(source,atlas),source);
 }finally{globalThis.document=prior;}
});
test('primary button and body text have strong contrast against the midnight UI',()=>{
 const lum=hex=>{const rgb=hex.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return luminance(rgb);};
 for(const color of [THEME.primary,THEME.text,THEME.muted])assert.ok((lum(color)+.05)/(lum(THEME.midnight)+.05)>4.5);
});
test('brand light stays white without neutralizing cyan technology, stone or local lighting',()=>{
 assert.equal(THEME.primary,'#F2F9FF');
 const rgb=icePixel(255,180,50);assert.ok(Math.min(...rgb)>215);assert.ok(Math.max(...rgb)-Math.min(...rgb)<30);
 for(const source of [[28,224,240],[245,240,232],[62,67,71]])assert.deepEqual(icePixel(...source),source);
 const leaves=icePixel(255,180,50,'foliage');assert.ok(leaves[1]>leaves[0]);assert.ok(leaves[2]<leaves[1]*.75);assert.ok(Math.max(...leaves)<180);
 assert.deepEqual(icePixel(242,78,183,'foliage'),[242,78,183]);
 for(const accent of Object.values(THEME.accents))assert.equal(visualAccent(accent),accent);
 assert.equal(visualAccent('#65deed'),'#65deed');
});
test('occupied interiors, furniture, shop signs and civic lights have separate material roles',()=>{
 const source=[255,180,50],role=(name,index,u,v)=>icePixel(...source,atlasColorRole(name,index,u,v));
 const counter=role('cafe',0,.5,.7),table=role('cafe',1,.5,.5),sign=role('cafe',0,.5,.2),leaves=role('terrain',8,.5,.4);
 assert.ok(counter[0]>counter[1]&&counter[1]>counter[2]);assert.ok(table[0]>table[1]&&table[1]>table[2]);assert.notDeepEqual(counter,table);
 assert.ok(Math.max(...sign)-Math.min(...sign)<30);assert.ok(leaves[1]>leaves[0]);
 assert.notDeepEqual(role('buildings',1,.5,.5),sign);assert.notDeepEqual(role('buildings',4,.7,.4),sign);
 assert.equal(BUILDING_PALETTES.hall.sign,THEME.primary);assert.equal(BUILDING_PALETTES.station.sign,THEME.primary);assert.equal(BUILDING_PALETTES.design.window,THEME.accents.amber);
 const brake=[248,24,18];assert.deepEqual(icePixel(...brake,atlasColorRole('vehicles',3,.5,.8)),brake);
 assert.notDeepEqual(role('vehicles',0,.5,.5),role('vehicles',4,.5,.5));
});
test('shared source colors retain different frame materials without leaking cached replacements',()=>{
 const prior=globalThis.document,pixels=new Uint8ClampedArray([255,180,50,255,255,180,50,128]);let output;
 globalThis.document={createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:pixels}),putImageData:d=>{output=d.data;}})})};
 try{
  themeAtlas({width:2,height:1},'cafe',[{sx:0,sy:0,sw:1,sh:1},{sx:1,sy:0,sw:1,sh:1}]);
  assert.deepEqual([...output.slice(0,3)],icePixel(255,180,50,'surface'));assert.deepEqual([...output.slice(4,7)],icePixel(255,180,50,'wood'));
  assert.deepEqual([output[3],output[7]],[255,128]);
 }finally{globalThis.document=prior;}
});
test('shared lighting remains white while local materials and character roles keep color',()=>{
 assert.equal(THEME.neon,THEME.lighting.primary);assert.equal(THEME.ui.accent,THEME.lighting.primary);
 const civic=['hall','design','test','station'];for(const id of civic)assert.equal(BUILDING_PALETTES[id].sign,THEME.primary);
 const whites=THEME.water.reflections.filter(c=>[THEME.primary,THEME.secondary].includes(c));assert.ok(whites.length>THEME.water.reflections.length/2);
 assert.equal(BUILDING_PALETTES.develop.window,THEME.accents.amber);assert.equal(BUILDING_PALETTES.research.sign,THEME.accents.lavender);
 assert.equal(visualRoleColor('Developer'),THEME.accents.cyan);assert.notEqual(visualRoleColor('Developer'),THEME.neon);
});
