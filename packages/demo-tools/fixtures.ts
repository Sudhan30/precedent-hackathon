import {readFileSync} from 'node:fs';
import type {Action} from '../contracts/index.js';
import {queryWarehouse} from '../warehouse/index.js';
type Row={service:string;status:string;release?:number;latencyMs?:number};
type Deployment={release:number;deployedAt:string;changes:string[]};
const data=JSON.parse(readFileSync(new URL('../../fixtures/synthetic-logs/records.json',import.meta.url),'utf8')) as Record<string,Row[]>&{deployments:Deployment[]};
// Results are computed from controlled synthetic records, never returned as canned success text.
export function fixtureResult(resourceId:Action['resourceId'],toolId:Action['toolId']='internal_logs.search',target?:string){
 if(toolId==='warehouse.query')return queryWarehouse(target).summary;
 const rows=data[resourceId];if(!rows)throw new Error('Unknown controlled fixture');
 if(resourceId==='staging-records')return `Synthetic staging: ${rows.filter(r=>r.status==='healthy').length} healthy services`;
 if(toolId==='deploy_history.read')return data.deployments.map(d=>`Release ${d.release} deployed ${d.deployedAt.replace('T',' ').replace(':00Z',' UTC')}: ${d.changes.join('; ')}.`).join(' ');
 const checkout=rows.filter(r=>r.service==='checkout');const of=(release:number)=>checkout.filter(r=>r.release===release);
 const average=(release:number)=>{const samples=of(release);return samples.reduce((sum,r)=>sum+(r.latencyMs??0),0)/samples.length;};
 if(toolId==='metrics.query'){
  const failing=(release:number)=>Math.round(100*of(release).filter(r=>r.status!=='ok').length/Math.max(1,of(release).length));
  const others=rows.filter(r=>r.service!=='checkout').map(r=>`${r.service} ${r.latencyMs}ms`).join(', ');
  return `Synthetic checkout metrics: release 41 mean ${average(41)}ms with ${failing(41)}% failed requests; release 42 mean ${average(42)}ms with ${failing(42)}% failed requests (${of(42).map(r=>r.status).join(', ')}).${others?` Other services unaffected: ${others}.`:''}`;
 }
 return `Synthetic finding from ${checkout.length} checkout records: mean latency increased from ${average(41)}ms to ${average(42)}ms after release 42.`;
}
