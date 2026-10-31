// A test database name must contain "test" as a word, e.g. social_media_test_db or app_test
export const isTestDatabaseName = (name) => /^[a-z0-9_]+$/i.test(name) && /(^|_)test(_|$)/i.test(name);

// Resolves and validates the test database URL. Shared by setupEnv and globalSetup.
export const getTestDatabaseUrl = () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. Add it to .env (see .env.example).');
  }

  const name = new URL(url).pathname.slice(1);
  if (!isTestDatabaseName(name)) {
    throw new Error(`Refusing to run tests: database "${name}" must be a dedicated test database (e.g. social_media_test_db).`);
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error('Refusing to run tests: TEST_DATABASE_URL must differ from DATABASE_URL.');
  }
  return { url, name };
};
