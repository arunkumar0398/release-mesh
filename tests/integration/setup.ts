import { assertTestDatabaseUrl } from "./test-database.js";

process.env.DATABASE_URL = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
