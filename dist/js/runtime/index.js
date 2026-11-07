import {RuntimeSyncController} from './sync-controller.js';
/** @import {SyncOptions} from './contracts' */
/** Read facade shared by consumers. Only the trusted application owner connects/configures. @param {SyncOptions} [options] */
export function createRuntimeIntegration(options={}){
 const owner=new RuntimeSyncController(options);
 const view=Object.freeze({getSnapshot:owner.getSnapshot.bind(owner),getAgent:owner.getAgent.bind(owner),getByNpc:owner.getByNpc.bind(owner),subscribe:owner.subscribe.bind(owner)});
 return Object.freeze({connect:owner.connect.bind(owner),disconnect:owner.disconnect.bind(owner),dispose:owner.dispose.bind(owner),
  setScope:owner.setScope.bind(owner),refresh:owner.refresh.bind(owner),view,...view});
}
// Disabled, credential-free page scope. Importing this module does not fetch or start timers.
export const runtimeIntegration=createRuntimeIntegration();
