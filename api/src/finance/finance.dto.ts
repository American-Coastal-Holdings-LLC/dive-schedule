import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateLedgerDto {
  @IsIn(['in', 'out']) kind!: string;
  @Type(() => Number) @IsNumber() amount!: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() date?: string; // YYYY-MM-DD (defaults to today, tenant tz)
}

export class PosLineDto {
  @IsOptional() @IsString() itemId?: string;
  @IsOptional() @IsString() name?: string;
  @Type(() => Number) @IsNumber() @Min(0) amount!: number; // unit price
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) qty?: number;
}

export class PosSaleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosLineDto)
  lines!: PosLineDto[];
  @IsIn(['cash']) method!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) received?: number;
}

export class SettingsDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) payRate?: number;
  @IsOptional() @IsString() reportCcEmail?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) estimateRatePerFoot?: number;
}
