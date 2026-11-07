// Sheet layout: role uses two rows; down/left on row 1, right/up on row 2.
const ROLE_INDEX={Researcher:0,Designer:1,Developer:2,Tester:3};
export class SpriteAnimator{
 constructor(seed=0){this.clock=seed*.19;this.direction='down';this.walking=false;this.frame=0;}
 update(dt,{moving=false,direction='down',working=false}={}){this.clock+=dt;this.walking=moving;this.direction=direction;
 if(moving)this.frame=[1,2,3,2][Math.floor(this.clock/.14)%4];
 else if(working)this.frame=[0,2,0,2][Math.floor(this.clock/.28)%4];
 else this.frame=[0,0,2,0][Math.floor(this.clock/.42)%4];}
 cell(role){const r=ROLE_INDEX[role]*2;return {col:(['left','up'].includes(this.direction)?4:0)+this.frame,row:r+(['right','up'].includes(this.direction)?1:0)};}
}
