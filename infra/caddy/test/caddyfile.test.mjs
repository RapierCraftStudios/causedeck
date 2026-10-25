// Static lint for the production Caddy config (#98): `node --test infra/caddy/test/`. Plain-text
// checks, like infra/scripts/compose-prod.test.mjs; `caddy validate` and `caddy adapt` (images.yml)
// and test/smoke.sh in the compose smoke cover parsing and runtime behaviour.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const caddy = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(caddy, file), 'utf8');
const caddyfile = read('Caddyfile');
const headers = read('snippets/security-headers.caddy');
const limits = read('snippets/rate-limits.caddy');
const logging = read('snippets/logging.caddy');
const gate = read('snippets/admin-gate.caddy');

// The body of `host.{$DOMAIN} { ... }` (blocks start at column 0 and end at a column-0 brace).
const site = (name) => {
  const start = caddyfile.indexOf(`\n${name}.{$DOMAIN} {\n`);
  assert.notEqual(start, -1, `${name} site block`);
  return caddyfile.slice(start, caddyfile.indexOf('\n}\n', start));
};

describe('sites and transport', () => {
  it('serves app, api, admin and static with automatic TLS and a TLS 1.2 floor', () => {
    for (const name of ['app', 'api', 'admin', 'static']) {
      assert.match(site(name), /import tls_policy/);
    }
    assert.match(caddyfile, /protocols tls1\.2 tls1\.3/);
    assert.doesNotMatch(caddyfile, /auto_https\s+off|disable_redirects|tls internal/);
  });
  it('enables HTTP/3 and bounded timeouts', () => {
    assert.match(caddyfile, /protocols h1 h2 h3/);
    for (const key of ['read_header', 'read_body', 'write', 'idle']) {
      assert.match(caddyfile, new RegExp(`${key} \\d+[sm]`));
    }
  });
  it('keeps the plain-HTTP /healthz for the compose healthcheck', () => {
    assert.match(caddyfile, /:80 \{[\s\S]*path \/healthz[\s\S]*respond "ok" 200/);
  });
  it('proxies to the upstreams compose defines', () => {
    assert.match(site('app'), /reverse_proxy web:3000/);
    assert.match(site('api'), /reverse_proxy api:3001/);
    assert.match(site('admin'), /reverse_proxy admin:3200/);
  });
  it('orders the rate-limit directive', () => {
    assert.match(caddyfile, /order rate_limit before basicauth/);
  });
});

describe('security headers', () => {
  it('sets HSTS (one year, subdomains) and the other headers on every site', () => {
    assert.match(headers, /Strict-Transport-Security "max-age=31536000; includeSubDomains"/);
    for (const name of [
      'Referrer-Policy',
      'Permissions-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy',
      'X-Content-Type-Options nosniff',
    ]) {
      assert.ok(headers.includes(name), name);
    }
    for (const name of ['app', 'api', 'admin', 'static']) {
      assert.match(site(name), /import security_headers "/);
    }
  });
  it('limits camera and microphone to self only on the app host', () => {
    assert.match(
      site('app'),
      /security_headers "camera=\(self\), microphone=\(self\), geolocation=\(\)"/,
    );
    for (const name of ['api', 'admin', 'static']) {
      assert.match(site(name), /security_headers "camera=\(\), microphone=\(\), geolocation=\(\)"/);
    }
  });
  it('leaves the nonce CSP to Next.js on app and admin, and never allows unsafe-inline scripts', () => {
    assert.doesNotMatch(site('app'), /Content-Security-Policy|strict_csp/);
    assert.doesNotMatch(site('admin'), /Content-Security-Policy|strict_csp/);
    assert.match(site('api'), /import strict_csp/);
    assert.match(site('static'), /import strict_csp/);
    assert.doesNotMatch(caddyfile + headers, /script-src[^;\n]*unsafe-inline/);
  });
});

describe('caching', () => {
  it('never sets CDN-cacheable headers on app, api and admin', () => {
    for (const name of ['app', 'api', 'admin']) {
      assert.match(site(name), /header \?Cache-Control "private, no-store"/);
      assert.doesNotMatch(site(name), /public|s-maxage/);
    }
  });
  it('serves only hashed assets on static, immutable, without cookies', () => {
    const block = site('static');
    assert.match(block, /path \/_next\/static\/\*/);
    assert.match(block, /header_down Cache-Control "public, max-age=31536000, immutable"/);
    assert.match(block, /header_down -Set-Cookie/);
    assert.match(block, /header_up -Cookie/);
    assert.match(block, /respond "Not found" 404/);
  });
});

describe('rate and size limits', () => {
  it('limits sign-in and magic link to 10 per minute per IP', () => {
    assert.match(limits, /@signin path [^\n]*\/api\/auth\/sign-in[^\n]*\/api\/auth\/magic-link/);
    assert.match(limits, /zone signin \{\s+key \{client_ip\}\s+events 10\s+window 1m/);
  });
  it('has webhook and upload zones, and applies limits on app, api and admin', () => {
    assert.match(limits, /zone webhooks \{[\s\S]*?events 1200/);
    assert.match(limits, /zone uploads \{[\s\S]*?events 60/);
    for (const name of ['app', 'api', 'admin']) {
      assert.match(site(name), /import rate_limits/);
      assert.match(site(name), /import body_limits/);
    }
  });
  it('caps bodies per route: uploads configurable, webhooks 5 MB, the rest 1 MB', () => {
    assert.match(limits, /\{\$UPLOAD_MAX_BODY:25MB\}/);
    assert.match(limits, /@webhookbody[\s\S]*max_size 5MB/);
    assert.match(limits, /@smallbody not path[\s\S]*max_size 1MB/);
  });
});

describe('admin gate', () => {
  it('answers 403 outside the allowlist, with loopback as the closed default', () => {
    assert.match(gate, /@denied not client_ip \{\$ADMIN_ALLOWLIST:127\.0\.0\.1\/32\}/);
    assert.match(gate, /respond "Forbidden" 403/);
    assert.match(site('admin'), /import admin_gate/);
  });
});

describe('access log', () => {
  it('is JSON on stdout, drops cookies and redacts credentials and query tokens', () => {
    assert.match(logging, /output stdout/);
    assert.match(logging, /wrap json/);
    assert.match(logging, /request>headers>Cookie delete/);
    assert.match(logging, /request>headers>Authorization replace REDACTED/);
    assert.match(logging, /resp_headers>Set-Cookie delete/);
    for (const param of ['token', 'access_token', 'code', 'secret', 'X-Amz-Signature']) {
      assert.match(logging, new RegExp(`replace ${param} REDACTED`));
    }
    for (const name of ['app', 'api', 'admin', 'static']) {
      assert.match(site(name), /import access_log/);
    }
  });
});

describe('image', () => {
  const dockerfile = read('Dockerfile');
  it('pins Caddy and the rate-limit module', () => {
    assert.match(dockerfile, /ARG CADDY_VERSION=\d+\.\d+\.\d+/);
    assert.match(dockerfile, /ARG RATELIMIT_COMMIT=[0-9a-f]{40}/);
    assert.match(dockerfile, /--with github\.com\/mholt\/caddy-ratelimit@\$\{RATELIMIT_COMMIT\}/);
  });
});

describe('fail2ban', () => {
  const filter = read('fail2ban/filter.d/causedeck-caddy.conf');
  const jail = read('fail2ban/jail.d/causedeck-caddy.local');
  const failregex = /^failregex = (.*)$/m.exec(filter)?.[1];
  assert.ok(failregex);
  const regex = new RegExp(failregex.replace('<HOST>', '(?<host>[0-9a-f.:]+)'));
  const line = (status, logger = 'http.log.access.log0') =>
    JSON.stringify({
      log: `${JSON.stringify({
        level: 'info',
        logger,
        msg: 'handled request',
        request: { remote_ip: '203.0.113.9', client_ip: '203.0.113.9', method: 'POST', uri: '/x' },
        status,
      })}\n`,
      stream: 'stdout',
    });

  it('matches 401 and 429 from the access log and extracts the client address', () => {
    for (const status of [401, 429]) {
      assert.equal(regex.exec(line(status))?.groups?.host, '203.0.113.9');
    }
  });
  it('ignores other statuses and other loggers', () => {
    for (const status of [200, 403, 404, 500]) assert.equal(regex.exec(line(status)), null);
    assert.equal(regex.exec(line(401, 'tls.obtain')), null);
  });
  it('bans for a configured period through DOCKER-USER', () => {
    assert.match(jail, /^enabled\s*= true/m);
    assert.match(jail, /^bantime\s*= \d+[mhd]/m);
    assert.match(jail, /^maxretry\s*= \d+/m);
    assert.match(jail, /^chain\s*= DOCKER-USER/m);
  });
});
