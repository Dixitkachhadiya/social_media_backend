import { Sequelize } from 'sequelize';

const { DATABASE_URL, NODE_ENV } = process.env;

// Connections per backend process. Hosted plans limit connections per database user (Clever Cloud's
// free PostgreSQL: 5), and that limit is shared by every process using the same credentials (e.g. a
// local backend and the Render backend). A pool larger than the limit makes concurrent requests fail;
// a smaller pool only makes them wait their turn.
const POOL_MAX = Number(process.env.DB_POOL_MAX) || 4;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined. Add it to your .env file.');
}

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  logging: NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: POOL_MAX,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  // When the database refuses a new connection because the per-user limit is reached (another process using
  // the same credentials holds the rest), wait briefly and try again instead of failing the request. Only
  // connection-limit errors are retried: the query itself never ran, so nothing executes twice.
  retry: {
    match: [/too many connections/i, /remaining connection slots/i, /ConnectionAcquireTimeoutError/],
    max: 10, // about 6 s of waiting in total before the request fails with 503
    backoffBase: 200,
    backoffExponent: 1.3,
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
