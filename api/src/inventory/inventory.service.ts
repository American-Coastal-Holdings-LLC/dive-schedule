import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound, unprocessable } from '../common/api-error';
import { Identity } from '../auth/identity';
import { PrismaService } from '../db/prisma.service';
import { serializeItem } from '../domain/serialize';
import { nextQty, parseInventoryImport } from './inventory-domain';
import {
  AdjustQuantityDto,
  CreateInventoryDto,
  ImportInventoryDto,
  UpdateInventoryDto,
} from './inventory.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(identity: Identity) {
    const items = await this.prisma.inventoryItem.findMany({
      where: { installationId: identity.installationId },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    return { items: items.map(serializeItem) };
  }

  async create(identity: Identity, dto: CreateInventoryDto) {
    const item = await this.prisma.inventoryItem.create({
      data: {
        installationId: identity.installationId,
        name: dto.name ?? '',
        type: dto.type ?? 'item',
        quantity: dto.quantity ?? 0,
        unitCost: dto.unitCost ?? 0,
        salePrice: dto.salePrice ?? 0,
        sku: dto.sku ?? '',
        lowStockAt: dto.lowStockAt ?? 0,
        notes: dto.notes ?? '',
      },
    });
    return { item: serializeItem(item) };
  }

  async update(identity: Identity, id: string, dto: UpdateInventoryDto) {
    const existing = await this.prisma.inventoryItem.findFirst({
      where: { id, installationId: identity.installationId },
    });
    if (!existing) throw notFound('Inventory item not found');
    const data: Prisma.InventoryItemUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.quantity !== undefined) data.quantity = dto.quantity;
    if (dto.unitCost !== undefined) data.unitCost = dto.unitCost;
    if (dto.salePrice !== undefined) data.salePrice = dto.salePrice;
    if (dto.sku !== undefined) data.sku = dto.sku;
    if (dto.lowStockAt !== undefined) data.lowStockAt = dto.lowStockAt;
    if (dto.notes !== undefined) data.notes = dto.notes;
    const item = await this.prisma.inventoryItem.update({ where: { id: existing.id }, data });
    return { item: serializeItem(item) };
  }

  /**
   * Receive or consume stock by a relative amount.
   *
   * RELATIVE, NOT ABSOLUTE, and that is the whole point. The standalone build sent the computed
   * total ("set quantity to 4") and guarded double-taps with an in-flight Set, which is only safe
   * while one browser is the only writer. Two divers working the same list would each send a total
   * computed from their own stale copy and the second write would erase the first. A delta cannot
   * lose a concurrent update, so the in-flight guard is not ported — a genuine double-tap means the
   * user meant -2, and that is what it now does.
   *
   * The `gte` guard makes "never below zero" part of the same statement as the decrement, so the
   * floor holds even when the read below is already out of date by the time the write lands.
   */
  async adjust(identity: Identity, id: string, dto: AdjustQuantityDto) {
    const existing = await this.prisma.inventoryItem.findFirst({
      where: { id, installationId: identity.installationId },
    });
    if (!existing) throw notFound('Inventory item not found');

    const { shortfall } = nextQty(existing.quantity, dto.delta);
    if (shortfall > 0) throw unprocessable(`Only ${existing.quantity} in stock`);

    const written = await this.prisma.inventoryItem.updateMany({
      where: {
        id: existing.id,
        installationId: identity.installationId,
        ...(dto.delta < 0 ? { quantity: { gte: -dto.delta } } : {}),
      },
      data: { quantity: { increment: dto.delta } },
    });

    // Zero rows means someone else drained the item between the read and the write — the row itself
    // cannot have vanished from under a scoped id without also failing the findFirst above.
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: existing.id, installationId: identity.installationId },
    });
    if (!item) throw notFound('Inventory item not found');
    if (written.count === 0) throw unprocessable(`Only ${item.quantity} in stock`);

    return { item: serializeItem(item) };
  }

  /** Parse a paste without writing anything — what the wizard renders while the user is still typing.
   *  Touches no data, so it takes no identity; the controller's permission guard is the gate. */
  importPreview(dto: ImportInventoryDto) {
    const { rows, errors, hasHeader } = parseInventoryImport(dto.text);
    return { rows, errors, hasHeader };
  }

  /**
   * Commit a paste. Re-parses the raw text rather than accepting the preview's rows, so the client
   * cannot hand back edited rows that never passed validation — the preview is a rendering of this
   * parse, never an input to it.
   */
  async import(identity: Identity, dto: ImportInventoryDto) {
    const { rows, errors } = parseInventoryImport(dto.text);
    if (!rows.length) throw unprocessable(errors[0] ?? 'Nothing to import');

    const result = await this.prisma.inventoryItem.createMany({
      data: rows.map((r) => ({ installationId: identity.installationId, ...r })),
    });
    return { created: result.count, errors };
  }

  async remove(identity: Identity, id: string) {
    const existing = await this.prisma.inventoryItem.findFirst({
      where: { id, installationId: identity.installationId },
    });
    if (!existing) throw notFound('Inventory item not found');
    await this.prisma.inventoryItem.delete({ where: { id: existing.id } });
    return { ok: true };
  }
}
