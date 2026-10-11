import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {BlockList,isIP} from 'node:net';
import type {Readable} from 'node:stream';
import {endpointSchema} from './contracts.js';

const blocked=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]] as const)blocked.addSubnet(address,prefix,'ipv4');
for(const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16]] as const)blocked.addSubnet(address,prefix,'ipv6');
export function publicAddress(address:string){
 const family=isIP(address);if(family===4)return !blocked.check(address,'ipv4');
 // Global unicast only; excludes mapped IPv4, loopback, link-local and ULA.
 return family===6&&/^[23][0-9a-f]{3}:/i.test(address)&&!blocked.check(address,'ipv6');
}
// A cancelled MCP response must stop the socket before any pending read enqueues.
export function boundedMcpBody(response:Readable):ReadableStream<Uint8Array>{
 const iterator=response[Symbol.asyncIterator]();let stopped=false,bytes=0;
 return new ReadableStream<Uint8Array>({
  async pull(controller){
   try{
    const next=await iterator.next();if(stopped)return;
    if(next.done){stopped=true;controller.close();return;}
    const chunk=next.value as Uint8Array;bytes+=chunk.byteLength;
    if(bytes>2*1024*1024)throw new Error('MCP response exceeded limit');
    controller.enqueue(chunk);
   }catch(error){if(!stopped){stopped=true;controller.error(error);response.destroy();}}
  },
  cancel(){stopped=true;response.destroy();},
 });
}
export function publicMcpFetch(endpoint:string,resolveAddresses:(host:string)=>Promise<{address:string;family:number}[]>=host=>lookup(host,{all:true,verbatim:true})):typeof fetch{
 const origin=new URL(endpointSchema.parse(endpoint)).origin;
 return async(input,init)=>{
  const incoming=input instanceof Request?input:undefined;
  const url=new URL(incoming?.url??String(input));endpointSchema.parse(url.href);
  if(url.origin!==origin)throw new Error('Cross-origin MCP requests are disabled');
  const addresses=await resolveAddresses(url.hostname);
  if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))throw new Error('MCP endpoint must resolve exclusively to public addresses');
  const selected=addresses[0],headers=new Headers(init?.headers??incoming?.headers);
  const body=init?.body??(incoming&&incoming.method!=='GET'&&incoming.method!=='HEAD'?await incoming.text():undefined);
  if(body!=null&&typeof body!=='string')throw new Error('Unsupported MCP request body');
  return new Promise<Response>((resolve,reject)=>{
   const request=httpsRequest(url,{method:init?.method??incoming?.method??'GET',headers:Object.fromEntries(headers),signal:init?.signal??incoming?.signal??undefined,
    // Pin the validated address for this request, closing the DNS rebinding gap.
    lookup:((_host:string,options:{all?:boolean},callback:Function)=>options.all?callback(null,[selected]):callback(null,selected.address,selected.family)) as any,
   },response=>{
    if((response.statusCode??0)>=300&&(response.statusCode??0)<400){response.destroy();reject(new Error('MCP redirects are disabled'));return;}
    const responseHeaders=new Headers();for(const [key,value]of Object.entries(response.headers))if(value!==undefined)responseHeaders.set(key,Array.isArray(value)?value.join(', '):value);
    const status=response.statusCode??502;
    if([204,205,304].includes(status)){response.resume();resolve(new Response(null,{status,headers:responseHeaders}));}
    else resolve(new Response(boundedMcpBody(response),{status,headers:responseHeaders}));
   });
   request.on('error',reject);request.end(body??undefined);
  });
 };
}
