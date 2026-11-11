// Pure visual choices shared by cached road rendering and offline validation.
export function tileVariation(col,row,surface){
 let value=Math.imul(col,0x1f123bb5)^Math.imul(row,0x5f356495)^Math.imul(surface,0x6c8e9cf5);
 value=Math.imul(value^(value>>>16),0x45d9f3b);return (value^(value>>>16))>>>0;
}

export function objectDepth(object,objects){
 const host=object.roofHostId&&objects.find(o=>o.id===object.roofHostId);
 return host?(host.depth??host.y)+1:(object.depth??object.y);
}

export const DECORATION_CONTEXTS={commercial:['bin','vending','sign','neon','planter'],residential:['planter','lamp','bench'],park:['tree','pinkTree','planter','bench'],promenade:['bin','bench','lamp','sign','planter']};
