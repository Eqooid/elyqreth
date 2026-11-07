// Render-only theme. No simulation state, identities, timing or geometry depend on it.
const lighting=Object.freeze({primary:'#F2F9FF',highlight:'#FFFFFF',secondary:'#DCEEFF',accent:'#B8DDF5',muted:'#7BAFD1',window:'#F2F9FF',building:'#DCEEFF',road:'#DCEEFF',reflection:'#F2F9FF',selection:'#F2F9FF'});
const accents=Object.freeze({cyan:'#67D5E8',lavender:'#B99AFF',amber:'#FFBE78',pink:'#F48DA9',green:'#79CFA7'});
export const THEME=Object.freeze({
 // Shared city lighting is white; saturated accents require an object-specific role.
 name:'Icy White',id:'icy-white',lighting,accents,materials:{wood:'#BC9369',navy:'#1D3045'},primary:lighting.primary,secondary:lighting.secondary,neon:lighting.primary,slate:'#344B63',midnight:'#111D2B',
 panel:'#182534ED',line:'#526576',muted:'#B5C3D0',text:'#F2F9FF',pink:accents.pink,violet:accents.lavender,success:'#A4D5BA',error:'#FF809B',
 ui:{accent:lighting.primary,hover:'#405469',selected:'#34495D',border:'#DCEEFF40',railBorder:'#DCEEFF66',header:'#111D2BEE',headerFade:'#111D2B80',brandGlow:'#F2F9FF44'},
 water:{base:'#102B3B',bands:['#183747','#204352','#285466','#346378'],crest:'#7195AB',ripple:'#9FC4D5',reflection:lighting.reflection,accent:accents.cyan,reflections:[lighting.primary,lighting.secondary,lighting.primary,accents.cyan,lighting.primary,accents.lavender,lighting.primary,accents.amber]},
 road:{asphalt:'#252E39',alley:'#303B47',grain:['#3C4955','#1C2833'],curb:'#7E8E9B',marking:'#B7C5D0',crossing:'#DCE6ED'}
});
export const CHARACTER_ATLASES=new Set(['characters','cafeResidents','lifeResidents','purposeResidents']);
export const visualRoleColor=role=>({Researcher:THEME.primary,Designer:THEME.pink,Developer:THEME.accents.cyan,Tester:THEME.violet}[role]||THEME.secondary);
export function visualAccent(color){
 if(!/^#[0-9a-f]{6}$/i.test(color||''))return color;
 // Only legacy brand colors become white. Local accents keep their own meaning.
 return ['#ff9a36','#ffc45b'].includes(color.toLowerCase())?THEME.primary:color;
}
const lightRamp=[[0,[7,13,20]],[.22,[52,75,99]],[.44,[112,130,147]],[.68,[220,230,240]],[.87,[242,249,255]],[1,[255,255,255]]];
const foliageRamp=[[0,[12,20,17]],[.22,[33,59,39]],[.44,[59,106,58]],[.68,[96,153,88]],[1,[160,215,142]]];
const interpolate=(ramp,luma)=>{let i=1;while(i<ramp.length-1&&luma>ramp[i][0])i++;const [start,a]=ramp[i-1],[end,z]=ramp[i],t=(luma-start)/(end-start);return a.map((v,j)=>Math.round(v+(z[j]-v)*t));};
// Material-aware rendering: light cores become nearly neutral white; foliage,
// character identity colors and magenta accents never become frosted surfaces.
export function icePixel(r,g,b,material='surface'){
 const max=Math.max(r,g,b),min=Math.min(r,g,b),luma=(.2126*r+.7152*g+.0722*b)/255;
 const warm=max>12&&r>=g*.92&&(g>b*1.22||b<r*.25)&&(max-min)/max>.24;
 if(material==='original'||material==='signal')return [r,g,b];
 if(material==='foliage')return warm?interpolate(foliageRamp,luma):[r,g,b];
 if(warm){
  if(material==='surface')return interpolate(lightRamp,luma);
  const color=THEME.accents[material]||THEME.materials[material];
  if(color){const rgb=color.slice(1).match(/../g).map(v=>parseInt(v,16));return interpolate([[0,[7,13,20]],[.22,[32,43,54]],[.68,rgb.map(v=>Math.round(v*.82))],[1,rgb]],luma);}
 }
 // Existing cyan technology, magenta paint, stone, bark and foliage are materials,
 // not automatically branded light. Their original shading and hues survive.
 return [r,g,b];
}
export const BUILDING_PALETTES=Object.freeze({hall:{sign:lighting.primary,window:lighting.window},develop:{sign:accents.pink,window:accents.amber},design:{sign:lighting.primary,window:accents.amber},test:{sign:lighting.primary,window:lighting.window},research:{sign:accents.lavender,window:lighting.window},station:{sign:lighting.primary,window:lighting.window}});
// Regions are normalized within existing inspected sprite frames, never world
// coordinates. Only warm source pixels are converted; these masks cannot affect
// sprite silhouettes, object placement, collision or animation frame selection.
export function atlasColorRole(name,index,u,v){
 if(name==='buildings'){
  if(index===1){if(u>.2&&u<.77&&v>.4&&v<.59)return 'pink';if(v>.73)return u>.8?'original':'amber';}
  if(index===2&&u>.16&&u<.58&&v>.65)return 'amber';
  if(index===4&&u>.45&&v>.23&&v<.76)return 'lavender';
 }
 if(name==='cafe'){
  if(index===0&&u>.2&&u<.84&&v>.57&&v<.85)return 'amber';
  if(index===0&&u>.18&&u<.82&&v>.44&&v<.57)return 'cyan';
  if(index>=1&&index<=5)return 'wood';
  if(index===6)return 'lavender';if(index===7)return 'amber';if(index===8)return 'original';
 }
 if(name==='terrain'){
  if(index===6||index===8&&v<.73)return 'foliage';
  if(index===8||index===9)return 'original';if(index===11)return 'wood';if(index===14)return 'amber';
 }
 if(name==='blueprintScenery'){
  if(index===1&&v>.26&&v<.44)return 'cyan';
  if(index===2&&v>.4&&v<.69&&u>.14&&u<.86)return 'lavender';
  if(index===3&&v>.4&&v<.69&&u>.14&&u<.86)return 'cyan';
  if(index===4&&v>.38&&u>.16&&u<.88)return 'amber';
 }
 if(name==='blueprintProps'&&index===5||name==='street'&&index===6)return 'amber';
 if(name==='street'&&index===7)return 'wood';
 if(name==='vehicles'){
  const direction=index%4,type=Math.floor(index/4);
  if((direction===3||direction===0&&u<.13||direction===1&&u>.87)&&v>.5)return 'signal';
  if((direction===0&&u>.87||direction===1&&u<.13||direction===2&&v>.76)&&v>.4)return 'surface';
  if(type===2&&v<.24)return 'amber';
  return type===0?'cyan':type===1?'original':'amber';
 }
 if(name==='scenery'&&[0,3,4].includes(index)&&v>.5)return 'amber';
 if(name==='architecture'&&[2,4,5].includes(index)&&v>.4)return 'amber';
 return 'surface';
}
export function themeAtlas(image,name,frames=[]){
 if(CHARACTER_ATLASES.has(name))return image; // Clothing, skin and directional activity poses remain original.
 const layer=document.createElement('canvas');layer.width=image.width;layer.height=image.height;
 const ctx=layer.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,layer.width,layer.height),d=pixels.data;
 // Cache repeated atlas colors once. Transparent gutters and alpha are untouched.
 const cache=new Map(),roles=new Map();let row=-1,rowFrames=[];
 for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;
 const x=i/4%layer.width,y=Math.floor(i/4/layer.width);
 if(y!==row){row=y;rowFrames=frames.map((f,index)=>({f,index})).filter(({f})=>y>=f.sy&&y<f.sy+f.sh);}
 const match=rowFrames.find(({f})=>x>=f.sx&&x<f.sx+f.sw),f=match?.f,index=match?.index;
 const role=f?atlasColorRole(name,index,(x-f.sx)/f.sw,(y-f.sy)/f.sh):'surface';
 if(!roles.has(role))roles.set(role,roles.size);
 const key=d[i]*65536+d[i+1]*256+d[i+2]+roles.get(role)*16777216;let rgb=cache.get(key);if(!rgb){rgb=icePixel(d[i],d[i+1],d[i+2],role);cache.set(key,rgb);}d[i]=rgb[0];d[i+1]=rgb[1];d[i+2]=rgb[2];}
 ctx.putImageData(pixels,0,0);return layer;
}
export function applyUiTheme(root=document.documentElement){
 for(const [key,value] of Object.entries({primary:THEME.ui.accent,secondary:THEME.secondary,cyan:THEME.lighting.accent,ink:THEME.midnight,slate:THEME.slate,panel:THEME.panel,line:THEME.line,text:THEME.text,muted:THEME.muted,pink:THEME.pink,error:THEME.error,success:THEME.success,'ui-hover':THEME.ui.hover,'ui-selected':THEME.ui.selected,'panel-border':THEME.ui.border,'rail-border':THEME.ui.railBorder,'header-opaque':THEME.ui.header,'header-fade':THEME.ui.headerFade,'brand-glow':THEME.ui.brandGlow}))root.style.setProperty(`--${key}`,value);
 root.dataset.theme=THEME.id;
}
