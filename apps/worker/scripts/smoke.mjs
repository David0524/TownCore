// Boots the built worker bundle, waits for "worker started", sends SIGTERM and expects a clean
// exit. Catches bundling problems that unit tests (which run the TypeScript source) can't.
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['dist/main.js'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
const fail = (reason) => {
  console.error(`Worker smoke test failed: ${reason}\n${output}`);
  child.kill('SIGKILL');
  process.exit(1);
};
const timer = setTimeout(() => fail('no "worker started" within 30s'), 30_000);

for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    output += chunk;
    if (output.includes('"msg":"worker started"') && !child.signalCode && !child.killed) {
      clearTimeout(timer);
      child.kill('SIGTERM');
    }
  });
}

child.on('exit', (code) => {
  if (code !== 0) fail(`exited with code ${code}`);
  if (!output.includes('"msg":"worker stopped"')) fail('did not log "worker stopped"');
  console.log('Worker smoke test passed: booted and shut down cleanly.');
});
