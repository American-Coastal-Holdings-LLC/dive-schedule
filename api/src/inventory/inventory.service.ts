import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound } from '../common/api-error';
import { Identity } from '../auth/identity';
import { PrismaService } from '../db/prisma.service';
import { serializeItem } from '../domain/serialize';
import { CreateInventoryDto, UpdateInventoryDto } from './inventory.dto';

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

  async remove(identity: Identity, id: string) {
    const existing = await this.prisma.inventoryItem.findFirst({
      where: { id, installationId: identity.installationId },
    });
    if (!existing) throw notFound('Inventory item not found');
    await this.prisma.inventoryItem.delete({ where: { id: existing.id } });
    return { ok: true };
  }
}
