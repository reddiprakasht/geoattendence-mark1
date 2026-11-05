import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const certificateDirectory = path.join(
  os.homedir(),
  '.copilot',
  'certificates',
  'geoattendance-local-https',
);
const rootCertificatePath = path.join(certificateDirectory, 'rootCA.pem');
const mkcertPath = path.join(certificateDirectory, 'mkcert.exe');
const certificatePath = path.join(certificateDirectory, 'dev-cert.pem');
const privateKeyPath = path.join(certificateDirectory, 'dev-key.pem');
const lanHost = process.env.VITE_HOST || getLanIPv4() || '127.0.0.1';

function getLanIPv4() {
  const interfaces = Object.entries(os.networkInterfaces());
  const orderedInterfaces = interfaces.sort(([nameA], [nameB]) => {
    const aIsWifi = /wi-?fi|wireless/i.test(nameA);
    const bIsWifi = /wi-?fi|wireless/i.test(nameB);
    return Number(bIsWifi) - Number(aIsWifi);
  });

  for (const [, addresses] of orderedInterfaces) {
    const address = addresses?.find(
      ({ family, internal, address: ip }) =>
        family === 'IPv4' &&
        !internal &&
        (/^10\./.test(ip) ||
          /^192\.168\./.test(ip) ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(ip)),
    );
    if (address) return address.address;
  }

  return null;
}

function rootCertificateDownload() {
  return {
    name: 'geoattendance-root-certificate-download',
    configureServer(server) {
      server.middlewares.use(
        '/.well-known/geofence-dev-root-ca.crt',
        (request, response, next) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.statusCode = 405;
            response.end();
            return;
          }

          readFile(rootCertificatePath).then(
            (certificate) => {
              response.statusCode = 200;
              response.setHeader('Content-Type', 'application/x-x509-ca-cert');
              response.setHeader(
                'Content-Disposition',
                'attachment; filename="geofence-dev-root-ca.crt"',
              );
              response.setHeader('Content-Length', certificate.length);
              response.end(request.method === 'HEAD' ? undefined : certificate);
            },
            next,
          );
        },
      );
    },
  };
}

export default defineConfig(({ command }) => {
  const server = { host: true, port: 5173, strictPort: true };

  if (command === 'serve') {
    execFileSync(
      mkcertPath,
      [
        '-key-file',
        privateKeyPath,
        '-cert-file',
        certificatePath,
        'localhost',
        '127.0.0.1',
        lanHost,
      ],
      {
        env: { ...process.env, CAROOT: certificateDirectory },
        stdio: 'inherit',
      },
    );
    server.https = {
      cert: readFileSync(certificatePath),
      key: readFileSync(privateKeyPath),
    };
  }

  return {
    server,
    plugins: [react(), rootCertificateDownload()],
  };
});
