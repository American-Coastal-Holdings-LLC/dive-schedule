import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenancyService } from './tenancy.service';

@Global()
@Module({
  providers: [PrismaService, TenancyService],
  exports: [PrismaService, TenancyService],
})
export class PrismaModule {}
