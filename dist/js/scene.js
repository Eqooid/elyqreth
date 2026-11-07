import {BUILDINGS,DECORATIONS,ROADS,SIDEWALKS,PUBLIC_SPACES,WATER_AREAS,BRIDGES,RAILWAYS} from './world.js';
import {SCENERY} from './scenery.js';
import {CAFE_OBJECTS,PARK_OBJECTS,PARK_BENCHES} from './locations.js';
// Lightweight scene graph: geometry, sprites and dynamic entities retain separate owners.
export class TownScene{
 constructor(simulation){this.simulation=simulation;
 this.ground={roads:ROADS,roadNetwork:simulation.map.roads,sidewalks:SIDEWALKS,publicSpaces:PUBLIC_SPACES,water:WATER_AREAS,bridges:BRIDGES,railways:RAILWAYS};
 this.buildings=BUILDINGS;this.decorations=DECORATIONS;this.scenery=SCENERY;
 this.worldObjects=[...BUILDINGS.map(object=>({kind:'workplace',object})),
 ...DECORATIONS.map(d=>({...d,...(PARK_BENCHES.find(b=>b.id===d.id)?{depth:PARK_BENCHES.find(b=>b.id===d.id).depth}: {})})).map(object=>({kind:'decoration',object})),...SCENERY.map(object=>({kind:'scenery',object})),...[...CAFE_OBJECTS,...PARK_OBJECTS].map(object=>({kind:'cafe',object}))];
 }
 get agents(){return this.simulation.agents;}
 get handoffs(){return this.simulation.packets;}
}
