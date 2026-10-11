import {BSON,type ChangeStream,type Collection} from 'mongodb';
import {setTimeout as delay} from 'node:timers/promises';
import type {DomainRuntime} from './runtime.js';

// Notifications report observed database changes. Permission checks always read
// the authoritative head in their transaction, independently of this stream.
export class PolicyWatch {
 readonly status={state:'starting',observedVersion:0,resumed:false,reconnects:0};
 private stream?:ChangeStream;private stopped=false;private job?:Promise<void>;
 constructor(private collection:Pick<Collection<{id:string;body:string;position:number}>,'watch'>,private runtime:DomainRuntime){}
 async start(){
  const saved=await this.runtime.run(s=>s.store.get('metadata','policy-watch'));
  try{await this.open(saved?.resumeToken);}catch(error){
   if(!this.expired(error))throw error;
   await this.stream?.close();await this.open(null);
  }
  this.job=this.loop();
 }
 private expired(error:unknown){const code=(error as {code?:number}).code;return code===286||code===260;}
 private async checkpoint(token:unknown,notify:boolean){
  await this.runtime.run(s=>{
   s.refreshWorkers();const previous=s.store.get('metadata','policy-watch');const version=s.policy().version;
   const serialized=token?BSON.EJSON.stringify(token):null;
   if(notify&&serialized!==previous?.resumeToken)s.emit('policy.observed',{version,source:'MongoDB Change Stream'});
   s.store.put('metadata',{id:'policy-watch',resumeToken:serialized,observedVersion:version,at:s.clock()});
   this.status.observedVersion=version;
  });
 }
 private async open(saved?:string|null){
  this.stream=this.collection.watch([{$match:{operationType:{$in:['insert','update','replace']}}}],{
   fullDocument:'updateLookup',maxAwaitTimeMS:500,...(saved?{resumeAfter:BSON.EJSON.parse(saved)}:{})
  });
  // Establish the cursor before returning: a lazy watch could miss a policy
  // published immediately after startup. Refresh also covers downtime gaps.
  const change=await this.stream.tryNext();
  await this.checkpoint(change?._id??this.stream.resumeToken,Boolean(change));
  this.status.resumed=Boolean(saved);this.status.state='live';
 }
 private async loop(){
  let resetToken=false;
  while(!this.stopped){
   try{
    const change=await this.stream!.tryNext();
    if(this.stopped)break;
    if(change)await this.checkpoint(change._id,true);
   }catch(error){
    if(this.stopped)break;
    this.status.state='reconnecting';this.status.reconnects++;
    resetToken=resetToken||this.expired(error);
    await this.stream?.close().catch(()=>undefined);
    await delay(500);
    if(this.stopped)break;
    try{
     const saved=await this.runtime.run(s=>s.store.get('metadata','policy-watch'));
     // An expired oplog token cannot resume. Open a new cursor and read the
     // current head; never infer authorization from a missed notification.
     await this.open(resetToken?null:saved?.resumeToken);resetToken=false;
    }catch(error){resetToken=resetToken||this.expired(error); /* Retry without exposing connection details. */ }
   }
  }
 }
 async close(){this.stopped=true;await this.stream?.close();await this.job;this.status.state='closed';}
}
