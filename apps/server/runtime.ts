import {warehouseCollection} from '../../packages/warehouse/index.js';
import {MongoClient} from 'mongodb';
import {z} from 'zod';
import {Module,Store as ModelenceStore,schema} from 'modelence/server';
import {Precedent} from './service.js';
import {PolicyWatch} from './policy-watch.js';
import {atlasEpisodeSearch,atlasPolicySearch,episodeProjection,lexicalIndex,vectorIndex,policyLexicalIndex,policyVectorIndex,type EpisodeSearch,type PolicySearch} from '../../packages/retrieval/atlas.js';
import type {Store} from './store.js';
import {atlasPlaybookIndex,playbookVectorCollection,playbookVectorIndex} from '../../packages/playbooks/atlas-vector.js';
import type {PlaybookIndex} from '../../packages/playbooks/index.js';
// read(): a consistent, read-only view for display and lookups. It never queues behind
// writes and never authorizes anything; authoritative decisions stay inside run().
// writes counts finished write transactions, so read-only views can tell whether a cached snapshot
// is current. Only runtimes whose every write passes through run() may expose it.
export interface DomainRuntime{run<T>(fn:(service:Precedent)=>T|Promise<T>):Promise<T>;writes?:number;read?<T>(fn:(service:Precedent)=>T|Promise<T>):Promise<T>;mode:string;readEvents?(cursor:number):Promise<Record<string,any>[]>;searchEpisodes?:EpisodeSearch;searchPolicies?:PolicySearch;playbookIndex?:PlaybookIndex;notifications?:{state:string;observedVersion:number;resumed:boolean;reconnects:number};close():Promise<void>;}
export class LocalRuntime implements DomainRuntime{
 mode='SQLite';constructor(readonly service:Precedent){}
 async run<T>(fn:(service:Precedent)=>T|Promise<T>){return fn(this.service);}
 async read<T>(fn:(service:Precedent)=>T|Promise<T>){return fn(this.service);}
 async readEvents(cursor:number){return this.service.store.all('event').slice(cursor,cursor+200);}
 async close(){this.service.store.close();}
}
const collectionNames:Record<string,string>={mcp_request:'mcp_requests',policy:'policy_heads',policy_version:'policy_versions',session:'sessions',run:'runs',event:'events',approval:'approvals',grant:'grants',execution:'executions',receipt:'receipts',episode:'episodes',incident:'incidents',metadata:'metadata',proposal:'proposals',usage_edge:'usage_edges',policy_rule:'policy_rules',playbook:'playbooks',membership:'memberships',memory_candidate:'memory_candidates',knowledge:'knowledge'};
export const atlasSearchLayout=()=>z.enum(['compact','full']).parse(process.env.ATLAS_SEARCH_LAYOUT??'compact');
// One server-side aggregation reads the same collections in the transaction's
// snapshot. No parallel driver operations or authoritative-state cache.
// The initial facet emits an anchor even in a new, empty metadata collection.
const snapshotFields={_id:0,id:1,body:1,position:1};
const snapshotPipeline=[
 {$facet:{metadata:[{$sort:{position:1}},{$project:snapshotFields}]}},
 ...Object.entries(collectionNames).filter(([kind])=>kind!=='metadata').map(([kind,from])=>({$lookup:{from,pipeline:[{$sort:{position:1}},{$project:snapshotFields}],as:kind}})),
 {$project:{records:{$concatArrays:Object.keys(collectionNames).map(kind=>({$map:{input:'$'+kind,as:'record',in:{kind:{$literal:kind},record:'$$record'}}}))}}},
 {$unwind:'$records'},{$replaceRoot:{newRoot:'$records'}},
];
function stores(){return Object.fromEntries(Object.entries(collectionNames).map(([kind,name])=>[kind,new ModelenceStore(name,{schema:{id:schema.string(),body:schema.string(),position:schema.number(),...(['episode','policy_rule'].includes(kind)?{policyVersion:schema.number().optional(),ruleId:schema.string().optional(),tenantId:schema.string().nullable().optional(),visibleRoles:schema.array(schema.string()).optional(),resourceId:schema.string().optional(),sessionId:schema.string().optional(),summary:schema.string().optional(),embedding:schema.embedding().optional(),embeddingModel:schema.string().nullable().optional()}: {})},indexes:[{key:{id:1},unique:true}]} )]));}
export const precedentModule=new Module('precedent',{stores:Object.values(stores()),queries:{status:()=>({application:'Precedent',scope:'Acme synthetic demo'})}});
type CollectionOperation=Parameters<ReturnType<ReturnType<typeof stores>[string]['rawCollection']>['bulkWrite']>[0][number];
export function memoryStore(initial:Map<string,Map<string,any>>){
 let data=initial;const changes=new Map<string,any>();
 const store:Store={
  all<T=any>(kind:string):T[]{return [...(data.get(kind)?.values()??[])].map(v=>structuredClone(v));},
  get<T=any>(kind:string,id:string):T|undefined{return structuredClone(data.get(kind)?.get(id));},
  put(kind:string,value:{id:string;[key:string]:any}){if(!collectionNames[kind])throw new Error('Unregistered record kind');if(!data.has(kind))data.set(kind,new Map());data.get(kind)!.set(value.id,structuredClone(value));changes.set(kind+'\0'+value.id,structuredClone(value));},
  atomic<T>(fn:()=>T):T{const before=structuredClone(data),dirty=new Map(changes);try{return fn();}catch(e){data=before;changes.clear();for(const [key,value]of dirty)changes.set(key,value);throw e;}},
  close(){}
 };return {store,changes,data:()=>data};
}
export class MongoRuntime implements DomainRuntime{
 async provisionSearchIndexes(){const results=[];const policyIndexes=atlasSearchLayout()==='full'?[policyLexicalIndex,policyVectorIndex]:[policyVectorIndex];for(const [kind,indexes] of [['episode',[lexicalIndex,vectorIndex]],['policy_rule',policyIndexes]] as const){const collection=this.collections[kind].rawCollection();const existing=await collection.listSearchIndexes().toArray();const missing=indexes.filter(index=>!existing.some(e=>e.name===index.name));if(missing.length)await collection.createSearchIndexes([...missing]);results.push({collection:collection.collectionName,indexes:z.array(z.object({name:z.string(),status:z.string().optional(),queryable:z.boolean().optional()})).parse(await collection.listSearchIndexes().toArray())});}
  // Playbook vectors: a plain collection (created if absent) with one vector index.
  const db=this.client.db();if(!(await db.listCollections({name:playbookVectorCollection}).toArray()).length)await db.createCollection(playbookVectorCollection);
  const vectors=db.collection(playbookVectorCollection);if(!(await vectors.listSearchIndexes().toArray()).some(e=>e.name===playbookVectorIndex.name))await vectors.createSearchIndexes([playbookVectorIndex]);
  results.push({collection:playbookVectorCollection,indexes:z.array(z.object({name:z.string(),status:z.string().optional(),queryable:z.boolean().optional()})).parse(await vectors.listSearchIndexes().toArray())});return results;}
 get searchPolicies(){return process.env.ATLAS_SEARCH_ENABLED==='true'?atlasPolicySearch(this.collections.policy_rule.rawCollection(),{lexical:atlasSearchLayout()==='full'}):undefined;}
 get playbookIndex(){return process.env.ATLAS_SEARCH_ENABLED==='true'?atlasPlaybookIndex(this.client.db().collection(playbookVectorCollection)):undefined;}
 get searchEpisodes(){return process.env.ATLAS_SEARCH_ENABLED==='true'?atlasEpisodeSearch(this.collections.episode.rawCollection()):undefined;}
 async readEvents(cursor:number){
  // Read only committed audit events. This observer cannot authorize actions
  // and does not queue a complete database transaction behind execution.
  const rows=await this.collections.event.rawCollection().find({},{readConcern:{level:'majority'}}).sort({position:1}).skip(cursor).limit(200).toArray();
  return rows.map(row=>JSON.parse(row.body));
 }
 private watch?:PolicyWatch;
 get notifications(){return this.watch?.status;}
 async startNotifications(){if(this.watch)return;this.watch=new PolicyWatch(this.collections.policy.rawCollection(),this);try{await this.watch.start();}catch{await this.watch.close();this.watch=undefined;throw new Error('Policy Change Stream initialization failed.');}}
 mode='MongoDB via Modelence Stores';writes=0;private tail:Promise<unknown>=Promise.resolve();private collections=stores();private constructor(private client:MongoClient){}
 static async connect(uri:string){let client:MongoClient|undefined;try{
  client=new MongoClient(uri,{serverSelectionTimeoutMS:5000});await client.connect();const runtime=new MongoRuntime(client);
  // Independent index reads/creation need not serialize cloud round trips.
  // Bound concurrency and settle a batch before closing a failed connection.
  const collections=Object.values(runtime.collections);for(const store of collections)store.init(client);
  for(let offset=0;offset<collections.length;offset+=4){
   const results=await Promise.allSettled(collections.slice(offset,offset+4).map(async store=>{
    const collection=store.rawCollection();const indexes=await collection.listIndexes().toArray().catch(error=>{if(error.code===26)return [];throw error;});
    if(!indexes.some(index=>index.unique===true&&JSON.stringify(index.key)===JSON.stringify({id:1})))await collection.createIndex({id:1},{unique:true,name:'_modelence_id_1'});
   }));
   if(results.some(result=>result.status==='rejected'))throw new Error('Required collection index initialization failed');
  }
  await runtime.run(()=>undefined);return runtime;
 }catch{await client?.close();throw new Error('MongoDB initialization failed; verify the configured database and replica set.');}}
 // One majority-read aggregation outside any transaction and outside the write queue.
 // Any attempted write fails loudly, so this path can never persist or authorize.
 async read<T>(fn:(service:Precedent)=>T|Promise<T>):Promise<T>{
  const data=new Map(Object.keys(collectionNames).map(kind=>[kind,new Map<string,any>()]));
  const rows=await this.collections.metadata.rawCollection().aggregate(snapshotPipeline,{readConcern:{level:'majority'}}).toArray();
  for(const {kind,record} of rows)data.get(kind)!.set(record.id,JSON.parse(record.body));
  const memory=memoryStore(data);const value=await fn(new Precedent(memory.store));
  if(memory.changes.size)throw new Error('A read-only operation attempted a write');
  return value;
 }
 run<T>(fn:(service:Precedent)=>T|Promise<T>):Promise<T>{
  const job=this.tail.then(async()=>{const session=this.client.startSession();try{return await session.withTransaction(async()=>{
   const data=new Map(Object.keys(collectionNames).map(kind=>[kind,new Map<string,any>()]));const positions=new Map<string,number>();
   const rows=await this.collections.metadata.rawCollection().aggregate(snapshotPipeline,{session}).toArray();
   for(const {kind,record} of rows){data.get(kind)!.set(record.id,JSON.parse(record.body));positions.set(kind+'\0'+record.id,record.position);}
   const memory=memoryStore(data);const service=new Precedent(memory.store);const value=await fn(service);
   const writes=new Map<string,CollectionOperation[]>();
   for(const [key,record]of memory.changes){
    const [kind,id]=key.split('\0');const position=positions.get(key)??memory.data().get(kind)!.size+positions.size;positions.set(key,position);
    const operations=writes.get(kind)??[];
    operations.push({updateOne:{filter:{id},update:{$set:{id,body:JSON.stringify(record),position,...(['episode','policy_rule'].includes(kind)?{...episodeProjection(record),...(kind==='policy_rule'?{policyVersion:record.policyVersion,ruleId:record.ruleId}:{})}:{})}},upsert:true}});
    writes.set(kind,operations);
   }
   // Batch records within each collection; keep collection writes sequential
   // inside the same majority-committed transaction, as the driver requires.
   for(const [kind,operations]of writes)await this.collections[kind].rawCollection().bulkWrite(operations,{ordered:true,session});
   return value;
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}}) as T;}finally{this.writes++;await session.endSession();}});
  this.tail=job.catch(()=>undefined);return job;
 }
 // Synthetic warehouse tables live in their own Atlas collection. Seeding replaces them only
 // when they differ from the catalog; queries read one table's rows in catalog order.
 async seedWarehouse(documents:Record<string,unknown>[]){const collection=this.client.db().collection(warehouseCollection);
  const stored=await collection.find({},{projection:{_id:0}}).sort({table:1,ordinal:1}).toArray();const sorted=[...documents].sort((a,b)=>String(a.table).localeCompare(String(b.table))||Number(a.ordinal)-Number(b.ordinal));
  if(JSON.stringify(stored)===JSON.stringify(sorted))return false;await collection.deleteMany({});if(documents.length)await collection.insertMany(documents.map(document=>({...document})));await collection.createIndex({table:1,ordinal:1});return true;}
 warehouseRows=async(table:string)=>(await this.client.db().collection(warehouseCollection).find({table},{projection:{_id:0,table:0,ordinal:0}}).sort({ordinal:1}).toArray()) as Record<string,string|number>[];
 async close(){await this.watch?.close();await this.tail;await this.client.close();}
}
export function asRuntime(service:Precedent|DomainRuntime):DomainRuntime{return 'run' in service?service:new LocalRuntime(service);}
