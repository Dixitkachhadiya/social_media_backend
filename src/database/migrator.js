import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Umzug, SequelizeStorage } from 'umzug';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Umzug migrator (the engine behind sequelize-cli) that loads ES module migrations.
 * Applied migrations are recorded in the "SequelizeMeta" table.
 */
// Pass { logger: undefined } to run silently
export const createMigrator = (sequelize, options = {}) =>
  new Umzug({
    migrations: {
      glob: ['*.js', { cwd: migrationsDir }],
      resolve: ({ name, path: filePath, context }) => {
        const load = () => import(pathToFileURL(filePath).href);
        return {
          name,
          up: async () => (await load()).up({ context }),
          down: async () => (await load()).down({ context }),
        };
      },
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: 'logger' in options ? options.logger : console,
  });
