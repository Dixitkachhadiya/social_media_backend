// Starts the local moderation inference service (FastAPI) with the project's Python venv.
// Usage: npm run moderation   (MODERATION_SERVICE_PORT defaults to 8001; bound to 127.0.0.1 only)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ai-moderation');
const python = process.platform === 'win32' ? path.join(root, '.venv', 'Scripts', 'python.exe') : path.join(root, '.venv', 'bin', 'python');
const port = process.env.MODERATION_SERVICE_PORT || '8001';

if (!fs.existsSync(python)) {
  console.error(`Python venv not found at ${python}. See ai-moderation/README.md (Setup).`);
  process.exit(1);
}

const child = spawn(python, ['-m', 'uvicorn', 'inference.service:app', '--host', '127.0.0.1', '--port', port], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
});
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
