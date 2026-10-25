// `ADMIN_IP_ALLOWLIST` (#309): comma-separated IPv4/IPv6 addresses and CIDRs, checked against the
// client IP. The env schema validates the syntax; this module only matches.
import { BlockList, isIP } from 'node:net';

export type IpAllowlist = (ip: string | undefined) => boolean;

/** IPv4-mapped IPv6 (`::ffff:203.0.113.7`) compares as the IPv4 address. */
function normalise(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return mapped?.[1] ?? ip;
}

function family(ip: string): 'ipv4' | 'ipv6' | undefined {
  const version = isIP(ip);
  if (version === 4) return 'ipv4';
  if (version === 6) return 'ipv6';
  return undefined;
}

/** Build a matcher from the raw list. Throws on an entry that is not an address or CIDR. */
export function parseIpAllowlist(raw: string): IpAllowlist {
  const list = new BlockList();
  for (const entry of raw.split(',').map((e) => e.trim())) {
    const [address = '', prefix] = entry.split('/');
    const type = family(normalise(address));
    if (type === undefined) throw new TypeError(`ADMIN_IP_ALLOWLIST: invalid entry "${entry}"`);
    if (prefix === undefined) {
      list.addAddress(normalise(address), type);
    } else {
      const bits = Number(prefix);
      const max = type === 'ipv4' ? 32 : 128;
      if (!/^\d+$/.test(prefix) || bits > max) {
        throw new TypeError(`ADMIN_IP_ALLOWLIST: invalid prefix in "${entry}"`);
      }
      list.addSubnet(normalise(address), bits, type);
    }
  }
  return (ip) => {
    if (ip === undefined) return false;
    const value = normalise(ip.trim());
    const type = family(value);
    return type !== undefined && list.check(value, type);
  };
}

/** Client IP as the reverse proxy reports it: first `x-forwarded-for` hop, else `x-real-ip`. */
export function clientIp(headers: Headers): string | undefined {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return headers.get('x-real-ip')?.trim() ?? undefined;
}
