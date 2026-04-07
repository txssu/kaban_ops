import { createMemoryDb, type Db } from '../../src/db/client'

export function makeDb(): Db {
  return createMemoryDb()
}
