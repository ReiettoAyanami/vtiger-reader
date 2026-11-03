import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Addresses that are not on the public internet: this machine, the LAN, link-local, carrier NAT,
 * documentation and benchmark ranges, multicast, reserved. A CRM address typed by a user must not
 * make the server call any of them (server-side request forgery, OWASP API Top 10 2023 #7).
 */
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, 'ipv6');
}

/** Is this IP address on the public internet? (An IPv4 written as IPv6, ::ffff:a.b.c.d, as IPv4.) */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return isPublicAddress(mapped);
  const family = isIP(address);
  if (family === 0) return false;
  return !NOT_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** True only when the name resolves, and every address it resolves to is public (as cerini-ia's _public_host). */
export async function isPublicHost(host: string): Promise<boolean> {
  const name = host.replace(/^\[|\]$/g, '');
  try {
    const addresses = await lookup(name, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
  } catch {
    return false;
  }
}
