import { CivilDate } from '../common/validation';
import { Type } from 'class-transformer';
import {
  IsArray, IsInt, IsUUID, Max, ArrayMinSize, ArrayMaxSize, MaxLength,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateLedgerDto {
  @IsIn(['in', 'out']) kind!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @CivilDate() date?: string; // YYYY-MM-DD (defaults to today, tenant tz)
}

export class PosLineDto {
  @IsOptional() @IsString() itemId?: string;
  @IsOptional() @IsString() name?: string;
  @Type(() => Number) @IsNumber() @Min(0) amount!: number; // unit price
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) qty?: number;
}

export class PosSaleDto {
  @IsUUID() requestId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PosLineDto)
  lines!: PosLineDto[];
  @IsIn(['cash']) method!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) received!: number;
}

export class SettingsDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1) payRate?: number;
  @IsOptional() @IsString() reportCcEmail?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) estimateRatePerFoot?: number;
}
