import { networkInterfaces } from 'node:os';

export function lanAddress(): string {
  const interfaces = networkInterfaces();
  const candidates = [interfaces.en0, ...Object.values(interfaces)].flat();
  for (const iface of candidates) {
    if (iface && iface.family === 'IPv4' && !iface.internal) return iface.address;
  }
  return '127.0.0.1';
}
