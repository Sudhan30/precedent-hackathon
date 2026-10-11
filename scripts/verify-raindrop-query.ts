import {mkdirSync,writeFileSync} from 'node:fs';
import {verifyRaindropEvent} from '../packages/observability/raindrop-query.js';

const eventIds=process.argv.slice(2);
if(!eventIds.length)throw new Error('Usage: npm run verify:raindrop:query -- <event-id> [event-id ...]');
const results=[];
for(const eventId of eventIds)results.push(await verifyRaindropEvent(eventId,process.env.RAINDROP_QUERY_API_KEY??''));
const proof={checkedAt:new Date().toISOString(),source:'Raindrop Query API read-back',results};
mkdirSync('.data',{recursive:true});writeFileSync('.data/raindrop-query-verification.json',JSON.stringify(proof,null,2));
console.log(JSON.stringify(proof));
