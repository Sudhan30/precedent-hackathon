import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import type {Action} from '../contracts/index.js';
export async function connectConnector(path:string){
 const client=new Client({name:'precedent-gateway',version:'1.0'});
 const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx',fileURLToPath(new URL('./connector.ts',import.meta.url))],env:{CONNECTOR_DB:path},stderr:'pipe'});
 await client.connect(transport);
 return {
  async execute(action:Action,id:string,baseline:boolean){const result=await client.callTool({name:'analyze',arguments:{executionId:id,toolId:action.toolId,sessionId:action.sessionId,resourceId:action.resourceId,baseline}},undefined,{timeout:5000});if(result.isError)throw new Error('Connector returned a tool error');return result.structuredContent as Record<string,any>;},
  async receipts(){const result=await client.callTool({name:'receipts',arguments:{}});return (result.structuredContent as {receipts:any[]}).receipts;},
  close:()=>client.close()
 };
}
