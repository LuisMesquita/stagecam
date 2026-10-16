import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import selfsigned from 'selfsigned';

export interface Cert {
  key: string;
  cert: string;
}

/** Self-signed cert for the camera listener, regenerated when the LAN address changes. */
export async function loadCert(dir: string, lanIp: string): Promise<Cert> {
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  const metaPath = join(dir, 'meta.json');
  if (existsSync(keyPath) && existsSync(certPath) && existsSync(metaPath)) {
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { ip?: string; expires?: number };
    if (meta.ip === lanIp && (meta.expires ?? 0) > Date.now() + 86_400_000) {
      return { key: await readFile(keyPath, 'utf8'), cert: await readFile(certPath, 'utf8') };
    }
  }
  const notAfterDate = new Date(Date.now() + 365 * 86_400_000);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'StageCam' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: lanIp },
        ],
      },
    ],
  });
  await mkdir(dir, { recursive: true });
  await writeFile(keyPath, pems.private, { mode: 0o600 });
  await writeFile(certPath, pems.cert);
  await writeFile(metaPath, JSON.stringify({ ip: lanIp, expires: notAfterDate.getTime() }));
  return { key: pems.private, cert: pems.cert };
}
