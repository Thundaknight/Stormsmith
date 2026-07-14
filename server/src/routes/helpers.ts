import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wraps an async route so rejections become JSON error responses. */
export function asyncRoute(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((err: any) => {
      const status = err?.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
      res.status(status >= 400 && status < 600 ? status : 500).json({
        error: err?.message || 'Internal server error',
      });
    });
  };
}
