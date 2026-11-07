import {center} from './world.js';
const key=p=>`${p.col},${p.row}`;
const manhattan=(a,b)=>Math.abs(a.col-b.col)+Math.abs(a.row-b.row);
// Cardinal A*: no diagonal corner-cutting through walls, water, or props.
export function findPath(map,from,destination){
 const start=map.nearestWalkable(from),goal=destination.col===undefined?map.cellAt(destination):destination;
 if(!start||!map.isWalkable(goal.col,goal.row))return [];
 const startKey=key(start),goalKey=key(goal),open=new Map([[startKey,start]]),came=new Map(),g=new Map([[startKey,0]]),f=new Map([[startKey,manhattan(start,goal)]]),closed=new Set();
 while(open.size){let bestKey=null,score=Infinity;for(const k of open.keys())if(f.get(k)<score){bestKey=k;score=f.get(k);}const current=open.get(bestKey);open.delete(bestKey);
 if(bestKey===goalKey){const cells=[current];let k=bestKey;while(came.has(k)){const previous=came.get(k);cells.unshift(previous);k=key(previous);}const points=cells.map((cell,i)=>i===0&&map.startPoint?map.startPoint:center(cell));
 // Recenter on the current tile first, so mid-walk interruption never crosses a wall.
 if(Math.hypot(points[0].x-from.x,points[0].y-from.y)<.1)points.shift();return points;}
 closed.add(bestKey);for(const next of map.neighbors(current)){const k=key(next);if(closed.has(k))continue;const cost=g.get(bestKey)+(map.pedestrianCost?.(next)??1);if(cost<(g.get(k)??Infinity)){came.set(k,current);g.set(k,cost);f.set(k,cost+manhattan(next,goal));open.set(k,next);}}
 }return [];
}
