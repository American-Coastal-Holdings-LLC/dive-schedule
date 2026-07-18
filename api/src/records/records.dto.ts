import { IsEmail } from 'class-validator';

export class SendRecordDto {
  @IsEmail() sentTo!: string;
}
