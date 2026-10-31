import { Sequelize } from 'sequelize';

const { DATABASE_URL, NODE_ENV } = process.env;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined. Add it to your .env file.');
}

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  logging: NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
});

/**
 * Verifies that the database is reachable with the configured credentials.
 * Throws a descriptive error if authentication fails.
 */
export const connectDatabase = async () => {
  try {
    await sequelize.authenticate();
    console.log('PostgreSQL connection established successfully.');
  } catch (error) {
    const reason = error.original?.message || error.message;
    throw new Error(`Unable to connect to PostgreSQL: ${reason}`, { cause: error });
  }
};

export default sequelize;
