import assert from 'node:assert/strict';

/** Real Canvas checks: the terrain cache must not depend on the camera zoom. */
export async function verifyTerrain({evaluate}){
 const report=await evaluate(`(async()=>{
  const {AssetManager}=await import('/js/assets.js'),{themeAtlas}=await import('/js/theme.js');
  const assets=new AssetManager(),image=await assets.loadImage('/assets/terrain-props.png');
  assets.frames.terrain=assets.inspectCells(image,4,4,true);assets.images.terrain=themeAtlas(image,'terrain',assets.frames.terrain);
  const reports=[];
  for(const index of [1,2,3,5,7]){
   const layer=document.createElement('canvas');layer.width=512;layer.height=256;
   const c=layer.getContext('2d');c.imageSmoothingEnabled=false;
   for(let y=0;y<256;y+=16)for(let x=0;x<512;x+=16)assets.tile(c,index,x,y,16);
   const pixels=c.getImageData(0,0,512,256).data;let seams=0,holes=0,zoomHoles=0;
   for(let y=0;y<256;y++)for(const x of [128,256,384])for(let k=0;k<4;k++)if(pixels[(y*512+x-1)*4+k]!==pixels[(y*512+x)*4+k])seams++;
   for(let x=0;x<512;x++)for(let k=0;k<4;k++)if(pixels[(127*512+x)*4+k]!==pixels[(128*512+x)*4+k])seams++;
   for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==255)holes++;
   for(const zoom of [.5,.775862,1,1.2,2,3]){
    const screen=document.createElement('canvas');screen.width=Math.ceil(512*zoom+4);screen.height=Math.ceil(256*zoom+4);
    const ctx=screen.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.translate(.375,.625);ctx.scale(zoom,zoom);ctx.drawImage(layer,0,0);
    const data=ctx.getImageData(0,0,screen.width,screen.height).data;
    for(let y=2;y<Math.floor(256*zoom)-1;y++)for(let x=2;x<Math.floor(512*zoom)-1;x++)if(data[(y*screen.width+x)*4+3]!==255)zoomHoles++;
   }
   reports.push({index,seams,holes,zoomHoles,cached:assets.terrainPattern(index)===assets.terrainPatterns.get(index)});
  }
  return reports;
 })()`);
 for(const row of report){assert.equal(row.seams,0,'Mismatched repeat edge in ground swatch '+row.index);assert.equal(row.holes,0,'Transparent ground cells in swatch '+row.index);assert.equal(row.zoomHoles,0,'Canvas gaps after zooming swatch '+row.index);assert.equal(row.cached,true);}
 return 'Continuous ground swatches: matching edges, opaque cells and no Canvas gaps at six zoom levels';
}
