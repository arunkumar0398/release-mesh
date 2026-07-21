export function assertTestDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("TEST_DATABASE_URL is required for integration tests");
  const url = new URL(value);
  const databaseName = url.pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error("Integration test database name must end with _test");
  }
  return value;
}
