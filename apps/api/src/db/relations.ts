import { defineRelations } from 'drizzle-orm'

import * as app from './schema/app'
import * as auth from './schema/auth'

// Relational queries (Better Auth's adapter uses db.query.*). App tables join the same registry;
// the CLI-generated auth part is a defineRelationsPart and must be spread last.
export const relations = {
  ...defineRelations({ ...auth, ...app }),
  ...auth.authRelations,
}
