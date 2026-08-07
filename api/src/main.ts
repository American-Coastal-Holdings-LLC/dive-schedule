import 'dotenv/config';
import 'reflect-metadata';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  // rawBody: true makes Nest retain the exact request bytes on `req.rawBody` alongside the parsed
  // body. The webhook signature (contract §8) is computed over those bytes, so verifying against a
  // re-serialized body would fail on any whitespace or key-order difference — and would accept a
  // reordered payload carrying a stale signature. This flag is load-bearing security, not a tuning
  // knob; removing it makes HmacWebhookVerifier reject every delivery.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  // Route Nest logging through pino.
  app.useLogger(app.get(Logger));

  // Security headers via helmet, CSP configurable from env. IMPORTANT: no
  // X-Frame-Options / frame-ancestors lockout in dev — the app must be iframable
  // inside the platform workspace. CSP_FRAME_ANCESTORS (space-separated origins)
  // adds a frame-ancestors allowlist for real deployments; empty removes it.
  const frameAncestors = (process.env.CSP_FRAME_ANCESTORS || '').trim();
  const directives: Record<string, string[] | null> = {
    'frame-ancestors': frameAncestors ? frameAncestors.split(/\s+/) : null,
  };
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: true, directives },
      frameguard: false,
    }),
  );

  // Global prefix /api, except the webhook receiver and liveness probe.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'healthz', method: RequestMethod.GET },
      { path: 'webhooks/platform', method: RequestMethod.POST },
    ],
  });

  // class-validator DTOs; validation failures surface as 422.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      errorHttpStatusCode: 422,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = parseInt(process.env.PORT || '4310', 10);
  await app.listen(port);
  app.get(Logger).log(`Dive Schedule API listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
