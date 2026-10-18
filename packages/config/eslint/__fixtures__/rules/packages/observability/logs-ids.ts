interface Logger {
  info(obj: unknown, msg?: string): void;
}

export function handle(logger: Logger, req: { body: string; id: string }): void {
  logger.info({ requestId: req.id, bodyLength: req.body.length }, 'received');
}
