import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCrewDto {
  @IsOptional() @IsString() @MaxLength(2000) certifications?: string;
  @IsOptional() @IsString() @MaxLength(4000) bio?: string;
  @IsOptional() @IsString() photo?: string; // image data URL or ''
  @IsOptional() @IsString() joined?: string; // YYYY-MM-DD
}
