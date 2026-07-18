import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Identity } from '../auth/identity';
import { P } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CreateInventoryDto, UpdateInventoryDto } from './inventory.dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @RequirePermissions(P.INVENTORY_VIEW)
  list(@CurrentIdentity() identity: Identity) {
    return this.inventory.list(identity);
  }

  @Post()
  @RequirePermissions(P.INVENTORY_MANAGE)
  create(@CurrentIdentity() identity: Identity, @Body() dto: CreateInventoryDto) {
    return this.inventory.create(identity, dto);
  }

  @Patch(':id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  update(
    @CurrentIdentity() identity: Identity,
    @Param('id') id: string,
    @Body() dto: UpdateInventoryDto,
  ) {
    return this.inventory.update(identity, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(P.INVENTORY_MANAGE)
  remove(@CurrentIdentity() identity: Identity, @Param('id') id: string) {
    return this.inventory.remove(identity, id);
  }
}
