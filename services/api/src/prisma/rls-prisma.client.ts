import { PrismaClient } from '@prisma/client';

/**
 * Prisma client extended with the row-level-security context helper.
 *
 * Every query that touches a user-data table MUST run inside `withUser`
 * (or set `app.current_user_id` itself). Postgres RLS policies are
 * FORCEd, so a missing context means zero rows — deny by default (§12.1 T4).
 */
export class RlsPrismaClient extends PrismaClient {
  /**
   * Runs `fn` in a transaction with `app.current_user_id` set for RLS.
   * The setting is transaction-local (set_config ..., true).
   */
  async withUser<T>(userId: string, fn: (tx: RlsTransaction) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx as RlsTransaction);
    });
  }
}

export type RlsTransaction = Omit<
  RlsPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
