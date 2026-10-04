import { Response } from 'express';

export function sendSuccess<T = any>(res: Response, data: T, statusCode: number = 200): void {
  res.status(statusCode).json({
    success: true,
    data
  });
}

export function sendError(
  res: Response,
  code: string,
  message: string,
  statusCode: number = 400
): void {
  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message
    }
  });
}
