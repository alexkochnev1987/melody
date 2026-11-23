import { networkInterfaces } from 'node:os';

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (process.env.NODE_ENV !== 'development' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    return Response.json({ origin: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const interfaces = networkInterfaces();
  const addresses = [...(interfaces.en0 ?? []), ...Object.entries(interfaces).filter(([name]) => name !== 'en0').flatMap(([, list]) => list ?? [])];
  const address = addresses.find(item => item.family === 'IPv4' && !item.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address));
  return Response.json({ origin: address ? `http://${address.address}:${url.port || '3000'}` : null }, { headers: { 'Cache-Control': 'no-store' } });
}
