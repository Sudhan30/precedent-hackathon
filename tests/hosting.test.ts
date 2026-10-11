import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateHosting} from '../apps/server/hosting.js';
test('hosted startup requires real authentication, live planning and an HTTPS origin',()=>{
 const hosted={NODE_ENV:'production',AUTH_MODE:'modelence',MONGODB_URI:'mongodb://test.invalid/precedent',MODELENCE_SITE_URL:'https://precedent.example.com'};
 assert.doesNotThrow(()=>validateHosting(hosted));assert.doesNotThrow(()=>validateHosting({AUTH_MODE:'demo'}));
 for(const overrides of [{AUTH_MODE:'demo'},{MONGODB_URI:''},{MODELENCE_SITE_URL:'http://precedent.example.com'},{MODELENCE_SITE_URL:'https://localhost'},{MODELENCE_SITE_URL:'https://user:password@example.com'},{MODELENCE_SITE_URL:'https://example.com/path'},{ALLOW_FIXTURE_PLANNER:'true'}])assert.throws(()=>validateHosting({...hosted,...overrides}));
});
