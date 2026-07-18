import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { ChecklistModule } from './checklist/checklist.module';
import { CrewModule } from './crew/crew.module';
import { PrismaModule } from './db/prisma.module';
import { FinanceModule } from './finance/finance.module';
import { HealthController } from './health/health.controller';
import { InventoryModule } from './inventory/inventory.module';
import { JobsModule } from './jobs/jobs.module';
import { MeController } from './me/me.controller';
import { PayModule } from './pay/pay.module';
import { PlatformModule } from './platform/platform.module';
import { RecordsModule } from './records/records.module';
import { WebhooksModule } from './webhooks/webhooks.module';

interface PinoReq {
  method: string;
  url: string;
  identity?: { userId: string; installationId: string };
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || 'info',
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:standard' } },
        autoLogging: { ignore: (req: unknown) => (req as PinoReq).url === '/healthz' },
        // Never log tokens or PII: only method/url/status, plus userId + installationId.
        serializers: {
          req(req: PinoReq) {
            return { method: req.method, url: req.url };
          },
          res(res: { statusCode: number }) {
            return { statusCode: res.statusCode };
          },
        },
        redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], remove: true },
        customProps: (req: unknown) => {
          const identity = (req as PinoReq).identity;
          return identity
            ? { userId: identity.userId, installationId: identity.installationId }
            : {};
        },
      },
    }),
    PrismaModule,
    PlatformModule,
    AuthModule,
    JobsModule,
    RecordsModule,
    ChecklistModule,
    CrewModule,
    PayModule,
    InventoryModule,
    FinanceModule,
    WebhooksModule,
  ],
  controllers: [HealthController, MeController],
})
export class AppModule {}
