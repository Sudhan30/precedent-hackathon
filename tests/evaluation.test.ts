import {test} from 'node:test';import assert from 'node:assert/strict';import {runEvaluations} from '../packages/evaluation/index.js';
test('labeled evaluation set has no unexpected decisions',()=>{const result=runEvaluations();assert.ok(result.total>=50);assert.deepEqual(result.results.filter(r=>!r.passed),[]);assert.equal(result.falseAllows,0);});
