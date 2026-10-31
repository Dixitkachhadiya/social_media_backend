// CLI: node src/database/migrate.js <up|down|status>
import '../config/env.js';
import sequelize from '../config/database.js';
import { createMigrator } from './migrator.js';

const command = process.argv[2] || 'up';
const migrator = createMigrator(sequelize, {
  logger: {
    info: (event) => console.log(`  ${event.event}: ${event.name}`),
    warn: console.warn,
    error: console.error,
    debug: () => {},
  },
});

try {
  if (command === 'up') {
    const applied = await migrator.up();
    console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database is up to date.');
  } else if (command === 'down') {
    const reverted = await migrator.down();
    console.log(reverted.length ? `Reverted: ${reverted.map((m) => m.name).join(', ')}` : 'Nothing to revert.');
  } else if (command === 'status') {
    const executed = await migrator.executed();
    const pending = await migrator.pending();
    executed.forEach((m) => console.log(`  [x] ${m.name}`));
    pending.forEach((m) => console.log(`  [ ] ${m.name}`));
  } else {
    console.error(`Unknown command "${command}". Use up, down or status.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
