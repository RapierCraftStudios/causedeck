interface Logger {
  info(obj: unknown, msg?: string): void;
}
interface Req {
  body: Record<string, unknown>;
  content: string;
}

export function handle(logger: Logger, req: Req, ctx: { logger: Logger }): void {
  logger.info(req.body);
  logger.info({ ...req.body });
  logger.info({ payload: req.content }, 'received');
  ctx.logger.info(req.content);
}
