import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export const ROTATIONS = ['weekly', 'biweekly', 'monthly', 'bimonthly'];

export class VideoDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() url?: string;
}

export class AnswerDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() a?: string;
}

export class CreateJobDto {
  @IsOptional() @IsString() site?: string;
  @IsOptional() @IsString() boat?: string;
  @IsOptional() @IsString() ownerName?: string;
  @IsOptional() @IsString() customerEmail?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) footage?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsIn(ROTATIONS) rotation?: string;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VideoDto)
  videos?: VideoDto[];
  @IsOptional() @IsArray() @IsString({ each: true }) assignedUserIds?: string[];
}

export class UpdateJobDto extends CreateJobDto {}

export class CompleteJobDto {
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() photo?: string; // image data URL
  @IsOptional() @IsString() videoUrl?: string;
  @IsOptional() @IsString() onBehalfOfUserId?: string; // requires dive.jobs.manage
  @IsOptional() @IsString() completedAt?: string; // ISO 8601 datetime for backdating
}

export class AnswersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];
}

export class CertifyDto {
  @IsBoolean() certified!: boolean;
}
