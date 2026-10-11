import {startApp,authenticate} from 'modelence/server';
import type express from 'express';
import type {Server} from 'node:http';
import {precedentModule} from './runtime.js';
import type {IdentityAdapter} from './api.js';

export const modelenceIdentity:IdentityAdapter={async resolve(req){
 const token=req.cookies?.authToken;if(typeof token!=='string')return null;
 const {user}=await authenticate(token);if(!user)return null;
 const role=user.hasRole('admin')?'admin':user.hasRole('employee')?'employee':null;
 if(!role)throw Object.assign(new Error('An administrator must assign an employee or admin role'),{status:403});
 return {userId:user.id,role,tenantId:'acme-demo'};
}};

export async function startModelence(app:express.Express){
 let server:Server|undefined;
 // Modelence owns the HTTP lifecycle and built-in auth/method endpoints.
 // Its current server implementation does not expose a bind-host option.
 // Constrain this local MVP to loopback through the provided server adapter.
 await startApp({modules:[precedentModule],roles:{employee:{description:'Investigate synthetic Acme resources'},admin:{description:'Review approvals and publish policies'}},security:{trustedProxies:'loopback'},server:{
  async init({httpServer}){
   server=httpServer;const listen=httpServer.listen.bind(httpServer);
   httpServer.listen=((port:number|string,callback:()=>void)=>listen(Number(port),'127.0.0.1',callback)) as typeof httpServer.listen;
  },
  handler(req,res){app(req,res);}
 }});
 return server!;
}
