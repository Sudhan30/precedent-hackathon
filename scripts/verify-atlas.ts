import {spawn} from 'node:child_process';
import {withDatabase} from '../packages/database/uri.js';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Configure MONGODB_URI in ignored .env.local before verifying Atlas.');
  process.exit(1);
}
const database = 'precedent_verify_' + Date.now();
const testUri = withDatabase(uri, database);
console.log('Verifying Atlas in isolated database: ' + database);
console.log('Verification records are retained; no database is dropped.');
const child = spawn(process.execPath, [
  '--import', 'tsx', '--test', '--test-concurrency=1',
  'tests/mongo.test.ts', 'tests/context.test.ts',
], {
  env: {...process.env, TEST_MONGODB_URI: testUri, ALLOW_FIXTURE_PLANNER: 'true',
    VOYAGE_API_KEY: '', RAINDROP_WRITE_KEY: '', ATLAS_SEARCH_ENABLED: 'false'},
  stdio: ['ignore', 'pipe', 'pipe'],
});
// Never let a driver error print a credential-bearing connection string.
for (const stream of [child.stdout!, child.stderr!]) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => process.stdout.write(
    chunk.replace(/mongodb(?:\+srv)?:\/\/[^\s"']+/g, '[MongoDB connection redacted]'),
  ));
}
child.once('error', () => {console.error('Could not start Atlas verification.'); process.exitCode = 1;});
child.once('exit', code => {process.exitCode = code ?? 1;});
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
