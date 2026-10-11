import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {fixtureResult} from './fixtures.js';
import {openStore} from '../../apps/server/store.js';
const store=openStore(process.env.CONNECTOR_DB??'.data/connector.db');
const server=new McpServer({name:'precedent-controlled-connector',version:'2.4'});
server.registerTool('analyze',{description:'Analyze fixed synthetic fixture data; no network or customer data access.',inputSchema:{executionId:z.string().min(1),toolId:z.enum(['example_connector.analyze','demo_export.send']),sessionId:z.string(),resourceId:z.enum(['customer-logs','sandbox-logs']),baseline:z.boolean()}},async input=>{
 const receipt=store.atomic(()=>{const old=store.get('downstream',input.executionId);if(old){if(JSON.stringify(old.input)!==JSON.stringify(input))throw new Error('Duplicate key scope mismatch');return old;}const r={id:randomUUID(),executionId:input.executionId,input,at:Date.now(),result:fixtureResult(input.resourceId)};store.put('downstream',{...r,id:input.executionId,receiptId:r.id});return {...r,id:input.executionId,receiptId:r.id};});
 return {content:[{type:'text',text:JSON.stringify(receipt)}],structuredContent:receipt};
});
server.registerTool('receipts',{description:'Inspect downstream receipt evidence.',inputSchema:{}},async()=>({content:[{type:'text',text:JSON.stringify(store.all('downstream'))}],structuredContent:{receipts:store.all('downstream')}}));
await server.connect(new StdioServerTransport());
