import { CivilDate } from '../common/validation';
import { Type } from 'class-transformer';
import {
  IsArray, IsUUID, IsInt, IsISO8601, MaxLength, ArrayMaxSize, IsEmail, ValidateIf,
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
  @IsOptional() @ValidateIf((_, v) => v !== '') @IsEmail() customerEmail?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) footage?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsIn(ROTATIONS) rotation?: string;
  @IsOptional() @CivilDate() dueDate?: string;
  @IsOptional() @IsString() @MaxLength(10000) notes?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VideoDto)
  videos?: VideoDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) assignedUserIds?: string[];
}

export class UpdateJobDto extends CreateJobDto {
  @IsISO8601() expectedUpdatedAt!: string;
}

export class ReopenJobDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(0) occurrence!: number;
}

export class CompleteJobDto extends ReopenJobDto {
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => AnswerDto) answers?: AnswerDto[];
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() @MaxLength(400000) photo?: string; // image data URL
  @IsOptional() @IsString() videoUrl?: string;
  @IsOptional() @IsString() onBehalfOfUserId?: string; // requires dive.jobs.manage
  @IsOptional() @IsISO8601({ strict: true }) completedAt?: string; // ISO 8601 datetime for backdating
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
