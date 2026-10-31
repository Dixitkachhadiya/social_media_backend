import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Loads Backend/.env by absolute path, so the right file is used no matter which directory the
// process is started from. Must be the first import of every entry point (server, migrations).
// Variables already set in the OS environment take precedence (dotenv default).
export const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');

dotenv.config({ path: envPath, quiet: true });
