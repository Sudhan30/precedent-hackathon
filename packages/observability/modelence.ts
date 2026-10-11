import type {RequestHandler} from 'express';
import {startTransaction,captureError} from 'modelence/telemetry';

export interface ApplicationMonitor {
 startTransaction(type:'route',name:string,context:Record<string,unknown>):{end(result?:string,context?:Record<string,unknown>):void};
 captureError(error:Error):void;
}
export const nativeModelenceMonitor:ApplicationMonitor={startTransaction,captureError};

/** Explicit route timings for Express handlers hosted by Modelence. Only
 * authored route patterns and measured outcomes reach the SDK. */
export function requestMonitoring(monitor:ApplicationMonitor):RequestHandler {
 return (req,res,next)=>{
  if(!req.path.startsWith('/api/')){next();return;}
  const started=performance.now();let ended=false;
  let transaction:ReturnType<ApplicationMonitor['startTransaction']>|undefined;
  try{transaction=monitor.startTransaction('route','precedent.http',{method:req.method});}catch{/* Monitoring must not affect requests. */}
  const complete=(disconnected:boolean)=>{
   if(ended)return;ended=true;
   // req.route.path is the authored template, never the client URL or query.
   const route=typeof req.route?.path==='string'?req.route.path:'unmatched';
   const context={method:req.method,route,status:res.statusCode,durationMs:performance.now()-started,disconnected};
   const failed=res.statusCode>=500;
   try{transaction?.end(disconnected?'disconnected':failed?'failure':'success',{context});}catch{/* Optional sink. */}
   if(failed)try{monitor.captureError(new Error('Precedent API request failed'));}catch{/* No raw request/provider error leaves this adapter. */}
  };
  res.once('finish',()=>complete(false));res.once('close',()=>complete(!res.writableFinished));
  next();
 };
}
