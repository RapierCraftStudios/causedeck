// Add-forum input helpers (#402), shared by the courts server action and the add-forum dialog: the
// suggested code for a custom forum and the website's hostname for its `config.hosts`. Pure, so
// both the server and the client bundle import them.
import { FORUM_CODE_PATTERN, HOSTNAME_PATTERN } from '@causedeck/validators/forum';

/** Custom forum codes start here, apart from the catalogue's `in.` codes. */
export const CUSTOM_FORUM_CODE_PREFIX = 'ws';

const MAX_SEGMENT = 40;

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SEGMENT)
    .replace(/-+$/, '');
}

/**
 * A forum code from its city and name, e.g. `ws.chennai.city-civil-court`, or `''` when the name has
 * no Latin letters or digits (a Tamil or Kannada name), so the lawyer types one.
 */
export function suggestForumCode(city: string, name: string): string {
  const forum = slug(name);
  if (forum === '') return '';
  const seat = slug(city);
  const code = [CUSTOM_FORUM_CODE_PREFIX, ...(seat === '' ? [] : [seat]), forum].join('.');
  return FORUM_CODE_PATTERN.test(code) ? code : '';
}

/**
 * The bare hostname of a court website typed as an https URL or a hostname, or null when it is
 * not one: another scheme (`http:`, `javascript:`), a port, credentials or an invalid host.
 */
export function websiteHost(input: string): string | null {
  const value = input.trim();
  if (value === '') return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (hasScheme && !/^https:\/\//i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(hasScheme ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') {
    return null;
  }
  const host = url.hostname.toLowerCase();
  return HOSTNAME_PATTERN.test(host) ? host : null;
}
