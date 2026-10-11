import {MongoRuntime,atlasSearchLayout} from '../apps/server/runtime.js';
let runtime:MongoRuntime|undefined;
try{
 if(!process.env.MONGODB_URI)throw new Error('Missing database configuration');
 runtime=await MongoRuntime.connect(process.env.MONGODB_URI);
 const indexes=await runtime.provisionSearchIndexes();
 console.log(JSON.stringify({layout:atlasSearchLayout(),indexes,next:'Wait for READY/queryable indexes, then enable ATLAS_SEARCH_ENABLED in .env.local and restart the API.'},null,2));
}catch(error){
 const message=error instanceof Error?error.message:'';
 if(/limit|maximum|too many/i.test(message))console.error('Atlas search index limit reached. Compact layout needs three indexes; full layout needs four. Free clusters allow three across the whole cluster. Keep ATLAS_SEARCH_ENABLED=false until capacity is resolved; existing indexes are retained.');
 else console.error('Atlas index setup failed. Verify MONGODB_URI, search support, and index-management permissions. Credentials are not logged.');
 process.exitCode=1;
}
finally{await runtime?.close();}
