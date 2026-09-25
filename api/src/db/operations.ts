import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { conflict, forbidden } from '../common/api-error';
import { Identity } from '../auth/identity';

export async function operation<T>(db: PrismaService, identity: Identity, key: string, payload: unknown,
  work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const fingerprint = createHash('sha256').update(JSON.stringify({ user: identity.userId, permissions:[...identity.permissions].sort(), payload })).digest('hex');
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity.installationId}, 0))`;
    const installation = await tx.installation.findUnique({ where: { id: identity.installationId } });
    if (installation?.status === 'uninstalled') throw forbidden('This installation has been removed');
    const old = await tx.operationReceipt.findUnique({ where: { installationId_key: { installationId: identity.installationId, key } } });
    if (old) {
      if (old.fingerprint !== fingerprint) throw conflict('Request key already used for a different operation');
      return old.result as T;
    }
    const result = await work(tx);
    await tx.operationReceipt.create({ data: { installationId: identity.installationId, key, fingerprint,
      result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue } });
    return result;
  }, { timeout: 15000 });
}

export async function audit(tx: Prisma.TransactionClient, identity: Identity, action: string, targetId: string,
  detail: Prisma.InputJsonValue = {}) {
  await tx.auditEvent.create({ data: { installationId: identity.installationId, actorId: identity.userId, action, targetId, detail } });
}
