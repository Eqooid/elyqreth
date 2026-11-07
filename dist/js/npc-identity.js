// Stable presentation slots, never movement IDs, names, coordinates or runtime permissions.
export const NPC_MANIFEST_VERSION=1;
export const CITY_ID='elyqreth';
export const NPC_IDS=Object.freeze(Array.from({length:20},(_,i)=>`resident-slot-${String(i+1).padStart(3,'0')}`));
/** @param {unknown} value */
export function validNpcId(value){return typeof value==='string'&&NPC_IDS.includes(value);}
