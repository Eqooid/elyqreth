/** @param {CanvasRenderingContext2D} c @param {ReturnType<import('./npc-status.js').visualForBinding>} visual
 * @param {number} x @param {number} y @param {number} time @param {boolean} reducedMotion */
export function drawNpcStatus(c,visual,x,y,time,reducedMotion){
 if(!visual||visual.status==='IDLE')return;
 c.save();c.translate(Math.round(x),Math.round(y));
 c.fillStyle='#111D2BF2';c.strokeStyle=visual.color;c.lineWidth=1.5;
 c.beginPath();c.rect(-8,-8,16,16);c.fill();c.stroke();
 c.fillStyle=visual.color;c.font='bold 14px ui-monospace,monospace';c.textAlign='center';c.textBaseline='middle';c.fillText(visual.glyph,0,0);
 if(visual.status==='RUNNING'){
  // Small icy progress accent, never a percentage or an execution guarantee.
  c.globalAlpha=reducedMotion?1:.55+.4*Math.sin(time*3);
  c.fillRect(-6,10,12,2);
 }
 c.restore();
}
