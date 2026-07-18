import { HttpException, HttpStatus } from '@nestjs/common';

// A domain error that carries a stable machine code. The global exception filter
// renders every error as { error: { code, message } }.
export class ApiException extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

export const unauthorized = (message = 'Unauthorized') =>
  new ApiException(HttpStatus.UNAUTHORIZED, 'unauthorized', message);
export const forbidden = (message = 'Forbidden') =>
  new ApiException(HttpStatus.FORBIDDEN, 'forbidden', message);
export const notFound = (message = 'Not found') =>
  new ApiException(HttpStatus.NOT_FOUND, 'not_found', message);
export const badRequest = (message = 'Bad request') =>
  new ApiException(HttpStatus.BAD_REQUEST, 'bad_request', message);
export const conflict = (message = 'Conflict') =>
  new ApiException(HttpStatus.CONFLICT, 'conflict', message);
export const unprocessable = (message = 'Unprocessable entity') =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'validation_error', message);
