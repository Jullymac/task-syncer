type Level = 'info' | 'warn' | 'error';

function log(level: Level, message: string, meta?: unknown) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta !== undefined ? { meta } : {}),
  };
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(entry));
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  }
}

export const logger = {
  info: (message: string, meta?: unknown) => log('info', message, meta),
  warn: (message: string, meta?: unknown) => log('warn', message, meta),
  error: (message: string, meta?: unknown) => log('error', message, meta),
};
