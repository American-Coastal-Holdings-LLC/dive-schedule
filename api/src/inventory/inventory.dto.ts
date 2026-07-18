import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export const INVENTORY_TYPES = ['item', 'part', 'tool'];

export class CreateInventoryDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn(INVENTORY_TYPES) type?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) quantity?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) unitCost?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) salePrice?: number;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) lowStockAt?: number;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateInventoryDto extends CreateInventoryDto {}
