import { testDatabaseUrl } from "../helpers/env";

// Every integration test talks to the dedicated test database, never the dev one.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET ??= "integration-test-secret-0123456789abcdef";
