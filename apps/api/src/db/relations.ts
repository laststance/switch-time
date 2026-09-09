import { defineRelations } from 'drizzle-orm'

import * as auth from './schema/auth'

// Relational queries (Better Auth's adapter uses db.query.*). App relations go into defineRelations();
// the CLI-generated auth part is a defineRelationsPart and must be spread last.
export const relations = { ...defineRelations(auth), ...auth.authRelations }
