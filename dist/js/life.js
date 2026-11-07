// Cosmetic inhabitant state. It never determines task eligibility or execution.
export const PERSONALITIES=['Curious','Relaxed','Focused','Sociable'];
export const LIFE_CONFIG={minutesPerSecond:2,startMinute:8*60,needRates:{energy:-.025,social:-.042,hunger:.05},decisionJitter:.15};
const clamp=n=>Math.max(0,Math.min(100,n));
export class CityClock{
 constructor({minutesPerSecond=LIFE_CONFIG.minutesPerSecond,startMinute=LIFE_CONFIG.startMinute}={}){this.totalMinutes=startMinute;this.minutesPerSecond=minutesPerSecond;}
 update(dt){this.totalMinutes+=dt*this.minutesPerSecond;}
 get minute(){return this.totalMinutes%1440;}
 get hour(){return this.minute/60;}
 get day(){return Math.floor(this.totalMinutes/1440)+1;}
 get period(){return this.hour<6||this.hour>=22?'Night':this.hour<12?'Morning':this.hour<18?'Afternoon':'Evening';}
 get darkness(){return this.hour>=20||this.hour<6?1:this.hour>=18?(this.hour-18)/2:this.hour<8?(8-this.hour)/2:0;}
 get label(){return `${String(Math.floor(this.hour)).padStart(2,'0')}:${String(Math.floor(this.minute%60)).padStart(2,'0')}`;}
}
export function initializeLife(a,homes,personality){a.personality=PERSONALITIES.includes(personality)?personality:PERSONALITIES[(a.id-1)%4];a.needs={energy:76+(a.id%4)*4,social:60+(a.id%3)*9,hunger:20+(a.id%5)*6};a.homeId=a.decorative?null:homes[(a.id-1)%homes.length].id;a.activityCooldowns={};a.lastActivities=[];a.hidden=false;a.shoppingBagRemaining=0;a.prop=null;a.workStatus='Idle';}
export function updateNeeds(a,dt){const r=LIFE_CONFIG.needRates,n=a.needs;if(!n)return;n.energy=clamp(n.energy+(a.activity?.definitionId==='rest'&&a.hidden ? .4 : r.energy)*dt);n.social=clamp(n.social+r.social*dt);n.hunger=clamp(n.hunger+r.hunger*dt);a.shoppingBagRemaining=Math.max(0,(a.shoppingBagRemaining||0)-dt);}
export function satisfy(a,id,dt){const n=a.needs;if(!n)return;if(id==='coffee'){n.energy=clamp(n.energy+.21*dt);n.hunger=clamp(n.hunger-.16*dt);}if(id==='reading')n.energy=clamp(n.energy+.17*dt);if(id==='eating')n.hunger=clamp(n.hunger-3.5*dt);if(id==='encounter'||a.state==='SOCIALIZING')n.social=clamp(n.social+.8*dt);}
export function bedtime(a,clock){return clock.hour>=21.7+(a.id%4)*.35||clock.hour<6.5+(a.id%3)*.4;}
export function utility(a,definition,location,clock,now,occupied=0){
 if((a.activityCooldowns?.[definition.id]||0)>now)return 0;
 if(definition.id==='rest'&&a.decorative)return 0;
 const n=a.needs||{energy:80,social:70,hunger:30},traits=a.personality;
 let score={coffee:18+(100-n.energy)*.45+(100-n.social)*.22,reading:18+(100-n.energy)*.24,shopping:8+n.hunger*.85,rest:6+(100-n.energy)*.5}[definition.id]||0;
 score+=({Sociable:{coffee:28},Curious:{reading:30,shopping:8},Relaxed:{reading:25,rest:12},Focused:{coffee:7,reading:4}}[traits]?.[definition.id]||0);
 if(definition.id==='rest'){if(bedtime(a,clock))score+=145;else if(n.energy>42)return 0;}
 if(clock.period==='Morning'&&definition.id==='coffee')score+=12;
 if(clock.period==='Evening'&&['coffee','reading'].includes(definition.id))score+=14;
 if(clock.period==='Night'&&definition.id!=='rest')score*=.5;
 const p=location.entry;score-=Math.hypot(a.x-(p.col*16+8),a.y-(p.row*16+8))*.016;
 if(a.decorative){if(a.visitorRole==='Café customer'&&definition.id==='coffee')score+=25;if(a.visitorRole==='Market visitor'&&definition.id==='shopping')score+=35;}score-=occupied*9;if(a.lastActivities?.at(-1)===definition.id)score*=.55;
 return Math.max(0,score);
}
