import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';

// Minimal response shape (avoids a hard dependency on @types/express).
interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

const STATUS_CODE: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'validation_error',
};

// Global filter → every error becomes { error: { code, message } }.
// - ApiException carries an explicit { code, message }.
// - ValidationPipe (422) yields { message: string[] } → joined.
// - Anything unexpected → 500 internal_error, details logged (never leaked).
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();

    let status = 500;
    let code = 'internal_error';
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>;
        if (typeof obj.code === 'string') {
          code = obj.code;
          message = typeof obj.message === 'string' ? obj.message : code;
        } else {
          code = STATUS_CODE[status] || 'error';
          if (Array.isArray(obj.message)) message = obj.message.join('; ');
          else if (typeof obj.message === 'string') message = obj.message;
          else if (typeof obj.error === 'string') message = obj.error;
        }
      } else if (typeof body === 'string') {
        code = STATUS_CODE[status] || 'error';
        message = body;
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    if (status >= 500 && !(exception instanceof Error)) {
      this.logger.error(`${code}: ${message}`);
    }

    response.status(status).json({ error: { code, message } });
  }
}
