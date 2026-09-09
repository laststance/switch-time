// Runs once per `vitest run`, before any worker: brings TEST_DATABASE_URL up to date with committed migrations.
export default async function setup() {
  await import('../db/migrate')
}
