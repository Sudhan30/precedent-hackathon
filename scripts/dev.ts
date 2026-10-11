import {spawn} from 'node:child_process';
const children=['server','web'].map(script=>spawn(process.execPath,['--run',script],{stdio:'inherit',env:process.env}));
let stopping=false;
function stop(code:number){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');process.exitCode=code;}
for(const child of children)child.on('exit',code=>stop(code??1));
process.on('SIGINT',()=>stop(0));process.on('SIGTERM',()=>stop(0));
