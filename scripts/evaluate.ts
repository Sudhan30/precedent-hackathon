import {runEvaluations} from '../packages/evaluation/index.js';
const result=runEvaluations();console.log(JSON.stringify(result,null,2));if(result.passed!==result.total)process.exitCode=1;
