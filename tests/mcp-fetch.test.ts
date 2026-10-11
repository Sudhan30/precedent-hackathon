import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Readable} from 'node:stream';
import {boundedMcpBody} from '../packages/mcp/public-fetch.js';

test('MCP response streams deliver content and enforce the response byte limit',async()=>{
 assert.equal(await new Response(boundedMcpBody(Readable.from([Buffer.from('hello'),Buffer.from(' world')]))).text(),'hello world');
 const large=Readable.from([Buffer.alloc(2*1024*1024+1)]);
 await assert.rejects(new Response(boundedMcpBody(large)).arrayBuffer(),/exceeded limit/);
 assert.equal(large.destroyed,true);
});
test('cancelling an MCP body during a pending read destroys the source without enqueuing after close',async()=>{
 const source=new PassThrough();const reader=boundedMcpBody(source).getReader();
 const pending=reader.read();await new Promise<void>(resolve=>setImmediate(resolve));
 await reader.cancel();assert.equal((await pending).done,true);assert.equal(source.destroyed,true);
 await new Promise<void>(resolve=>setImmediate(resolve));assert.equal((await reader.read()).done,true);
});
test('an aborted MCP source rejects its response reader without crashing the process',async()=>{
 const source=new PassThrough();const read=new Response(boundedMcpBody(source)).text();
 await new Promise<void>(resolve=>setImmediate(resolve));source.destroy(new Error('Connection aborted'));
 await assert.rejects(read,/Connection aborted/);
});
