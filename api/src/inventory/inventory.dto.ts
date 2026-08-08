import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, NotEquals } from 'class-validator';
import { IMPORT_MAX_CHARS, INVENTORY_TYPES } from './inventory-domain';

export { INVENTORY_TYPES };

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

/** A relative stock movement: positive receives, negative consumes. Bounded so one fat-fingered
 *  paste into the stepper cannot write a nonsense quantity the tenant then has to correct by hand. */
export class AdjustQuantityDto {
  @Type(() => Number) @IsInt() @NotEquals(0) @Min(-100_000) @Max(100_000) delta!: number;
}

/** Raw pasted CSV/TSV. Length-capped here as well as in the parser: the parser's cap is a domain
 *  rule, this one keeps an oversized body from being deserialized in the first place. */
export class ImportInventoryDto {
  @IsString() @MaxLength(IMPORT_MAX_CHARS) text!: string;
}
