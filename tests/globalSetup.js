// Runs once before all tests: creates the test database if needed and applies migrations.
import dotenv from 'dotenv';
import { Sequelize } from 'sequelize';
import { createMigrator } from '../src/database/migrator.js';
import { getTestDatabaseUrl } from './testDatabase.js';

export default async () => {
  dotenv.config({ quiet: true });
  const { url, name } = getTestDatabaseUrl();

  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = '/postgres';
  const admin = new Sequelize(maintenanceUrl.toString(), { logging: false });
  const [existing] = await admin.query('SELECT 1 FROM pg_database WHERE datname = :name', { replacements: { name } });
  if (!existing.length) {
    // name is validated by getTestDatabaseUrl (letters, digits, underscores only)
    await admin.query(`CREATE DATABASE "${name}"`);
  }
  await admin.close();

  const sequelize = new Sequelize(url, { logging: false });
  await createMigrator(sequelize, { logger: undefined }).up();
  await sequelize.close();
};
