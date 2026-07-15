import { Kysely } from 'kysely';
import { getDialect } from './dialect.js';

export function createDb(): Kysely<any> {
  return new Kysely({ dialect: getDialect() });
}
