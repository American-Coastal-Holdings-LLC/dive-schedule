import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Identity } from '../auth/identity';
import { P } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import {
  AdjustQuantityDto,
  CreateInventoryDto,
  ImportInventoryDto,
  UpdateInventoryDto,
} from './inventory.dto';
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

  // Declared ahead of the :id routes so the literal path can never be read as an item id.
  @Post('import/preview')
  @RequirePermissions(P.INVENTORY_MANAGE)
  importPreview(@Body() dto: ImportInventoryDto) {
    return this.inventory.importPreview(dto);
  }

  @Post('import')
  @RequirePermissions(P.INVENTORY_MANAGE)
  import(@CurrentIdentity() identity: Identity, @Body() dto: ImportInventoryDto) {
    return this.inventory.import(identity, dto);
  }

  // Stock movement is a manage action, not a view one: a diver with inventory.view can read the
  // count but cannot change it.
  @Post(':id/adjust')
  @RequirePermissions(P.INVENTORY_MANAGE)
  adjust(
    @CurrentIdentity() identity: Identity,
    @Param('id') id: string,
    @Body() dto: AdjustQuantityDto,
  ) {
    return this.inventory.adjust(identity, id, dto);
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
