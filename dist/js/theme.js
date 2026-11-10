// Render-only theme. No simulation state, identities, timing or geometry depend on it.
export const PALETTE=Object.freeze({midnight:'#243449',cyan:'#31B6C4',purple:'#8E77CB',amber:'#F0B96C',ice:'#E0F0FF'});
const lighting=Object.freeze({primary:PALETTE.cyan,highlight:PALETTE.ice,secondary:PALETTE.purple,accent:PALETTE.cyan,muted:'#5E7898',window:PALETTE.ice,building:PALETTE.cyan,road:PALETTE.cyan,reflection:PALETTE.cyan,selection:PALETTE.cyan});
const accents=Object.freeze({cyan:PALETTE.cyan,lavender:PALETTE.purple,amber:PALETTE.amber,pink:'#F48DA9',green:'#79CFA7'});
export const THEME=Object.freeze({
 // Cyan civic lighting, purple technology and amber occupied interiors share dark blue materials.
 name:'Neon Tech City',id:'neon-tech-city',lighting,accents,materials:{wood:'#BC9369',navy:PALETTE.midnight},primary:lighting.primary,secondary:PALETTE.ice,neon:lighting.primary,slate:'#344B63',midnight:PALETTE.midnight,
 panel:'#1B2A3DED',line:'#526B85',muted:'#B2C5DB',text:PALETTE.ice,pink:accents.pink,violet:accents.lavender,success:'#A4D5BA',error:'#FF809B',
 ui:{accent:lighting.primary,hover:'#3B536D',selected:'#344B63',border:PALETTE.cyan+'40',railBorder:PALETTE.purple+'66',header:PALETTE.midnight+'EE',headerFade:PALETTE.midnight+'80',brandGlow:PALETTE.cyan+'44'},
 water:{base:'#102A3A',bands:['#173748','#204354','#285468','#34647A'],crest:'#6C96AE',ripple:'#9FC4D5',reflection:lighting.reflection,accent:accents.cyan,reflections:[PALETTE.cyan,PALETTE.purple,PALETTE.cyan,PALETTE.amber,PALETTE.cyan,PALETTE.purple,PALETTE.ice,PALETTE.amber]},
 road:{asphalt:'#172638',alley:'#293B50',grain:['#304257','#122032'],curb:'#607F99',marking:'#9AB5CB',crossing:PALETTE.ice}
});
export const CHARACTER_ATLASES=new Set(['characters','cafeResidents','lifeResidents','purposeResidents']);
export const visualRoleColor=role=>({Researcher:THEME.accents.amber,Designer:THEME.pink,Developer:THEME.accents.cyan,Tester:THEME.violet}[role]||THEME.secondary);
export function visualAccent(color){
 if(!/^#[0-9a-f]{6}$/i.test(color||''))return color;
 // Only legacy brand colors become cyan. Local accents keep their own meaning.
 return ['#ff9a36','#ffc45b'].includes(color.toLowerCase())?THEME.primary:color;
}
const rgb=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16));
const lightRamp=[[0,[8,15,26]],[.22,rgb(PALETTE.midnight)],[.44,[52,86,116]],[.68,rgb(PALETTE.cyan)],[.94,rgb(PALETTE.ice)],[1,rgb(PALETTE.ice)]];
const surfaceRamp=[[0,[8,15,26]],[.22,[23,37,55]],[.44,rgb(PALETTE.midnight)],[.68,[61,82,108]],[1,[139,167,190]]];
const foliageRamp=[[0,[12,20,17]],[.22,[33,59,39]],[.44,[59,106,58]],[.68,[96,153,88]],[1,[160,215,142]]];
const interpolate=(ramp,luma)=>{let i=1;while(i<ramp.length-1&&luma>ramp[i][0])i++;const [start,a]=ramp[i-1],[end,z]=ramp[i],t=(luma-start)/(end-start);return a.map((v,j)=>Math.round(v+(z[j]-v)*t));};
// Material-aware color replacement only. Neutral structures become dark blue;
// existing warm light cores become cyan. Foliage and character identities survive.
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
 if(material==='surface'&&max-min<=Math.max(12,max*.18))return interpolate(surfaceRamp,luma);
 // Existing cyan technology, magenta paint, bark and foliage retain their materials.
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
