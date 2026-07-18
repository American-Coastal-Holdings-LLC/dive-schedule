import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class PayQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() week?: number; // week offset from current
  @IsOptional() @IsString() userId?: string; // requires pay.view-all when != self
}
