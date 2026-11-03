import { describe, expect, it } from 'vitest';
import { isPublicAddress, isPublicHost } from '../../src/shared/public-host.js';

describe('public addresses only', () => {
  it('refuses this machine, the LAN, link-local, carrier NAT, reserved and multicast ranges', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.10',
      '169.254.169.254', // the cloud metadata service
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd12:3456::1',
      '::ffff:192.168.1.10',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it('takes public ones', () => {
    for (const address of ['8.8.8.8', '172.32.0.1', '151.101.1.69', '2a00:1450:4002::64', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it('a host is public only when it resolves, to public addresses (no network needed for these)', async () => {
    expect(await isPublicHost('127.0.0.1')).toBe(false);
    expect(await isPublicHost('[::1]')).toBe(false);
    expect(await isPublicHost('localhost')).toBe(false);
    expect(await isPublicHost('8.8.8.8')).toBe(true);
    expect(await isPublicHost('does-not-exist.invalid')).toBe(false);
  });
});
