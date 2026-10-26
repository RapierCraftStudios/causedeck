// Static policy lint for infra/terraform (#99): `node --test infra/terraform/test/policy.test.mjs`.
// Plain-text checks (no HCL parser, like infra/scripts/compose-prod.test.mjs) so it runs without
// Terraform; `terraform validate/plan/test` and checkov run in .github/workflows/terraform.yml and
// envs/prod/tests/residency.tftest.hcl repeats the residency rules against the real graph.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const tf = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(tf, '..', '..');
const read = (...p) => readFileSync(path.join(tf, ...p), 'utf8');
const mod = (name, file) => read('modules', name, file);
const ENVS = ['prod', 'staging'];
const VPS = ['vps-do-blr1', 'vps-lightsail-mumbai'];

// Top-level blocks `kind "a" "b" { ... }` of a file as { head, body } using brace matching.
function blocks(text, kind) {
  const out = [];
  const re = new RegExp(`^${kind}\\s*((?:"[^"]+"\\s*)*)\\{`, 'gm');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
    }
    out.push({
      labels: [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
      body: text.slice(re.lastIndex, i - 1),
    });
  }
  return out;
}
const nested = (body, name) => blocks(body.replace(/^\s+/gm, ''), name);
const variable = (text, name) => blocks(text, 'variable').find((b) => b.labels[0] === name);
const outputNames = (text) =>
  blocks(text, 'output')
    .map((b) => b.labels[0])
    .sort();
const allTf = () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.tf')) files.push(full);
    }
  };
  walk(tf);
  return files;
};

describe('residency: app, api and admin are DNS-only by default', () => {
  const zone = mod('cloudflare-zone', 'main.tf');
  const records = blocks(zone, 'resource').filter((b) => b.labels[0] === 'cloudflare_dns_record');

  it('covers app, api and admin with one gated for_each', () => {
    assert.match(zone, /app_hosts\s*=\s*toset\(\["app", "api", "admin"\]\)/);
    for (const name of ['app_hosts_a', 'app_hosts_aaaa']) {
      const r = records.find((b) => b.labels[1] === name);
      assert.ok(r, `missing ${name}`);
      assert.match(r.body, /proxied\s*=\s*var\.app_proxied\b/);
    }
  });

  it('only the site and static records are ever proxied = true', () => {
    for (const file of allTf()) {
      for (const r of blocks(readFileSync(file, 'utf8'), 'resource')) {
        if (r.labels[0] !== 'cloudflare_dns_record' || !/proxied\s*=\s*true\b/.test(r.body))
          continue;
        assert.ok(
          ['site', 'static', 'static_aaaa'].includes(r.labels[1]),
          `${path.relative(tf, file)}: ${r.labels[1]} must not be hardcoded proxied`,
        );
      }
    }
  });

  it('app_proxied defaults to false and needs residency_decision_ref (zone module and envs)', () => {
    const vars = [
      mod('cloudflare-zone', 'variables.tf'),
      ...ENVS.map((e) => read('envs', e, 'variables.tf')),
    ];
    for (const text of vars) {
      const v = variable(text, 'app_proxied');
      assert.match(v.body, /default\s*=\s*false/);
      assert.match(v.body, /validation\s*\{[^}]*residency_decision_ref/s);
    }
  });
});

describe('static CDN', () => {
  const cdn = mod('cloudflare-static-cdn', 'main.tf');
  const text = cdn;

  it('proxies static.<tld> and enables tiered cache', () => {
    const rec = blocks(cdn, 'resource').find((b) => b.labels[1] === 'static');
    assert.match(rec.body, /proxied\s*=\s*true/);
    assert.match(cdn, /cloudflare_tiered_cache/);
    assert.match(cdn, /value\s*=\s*"on"/);
  });

  it('caches only hashed static paths, fonts and images', () => {
    const cacheRule = text.slice(
      text.indexOf('Cache hashed static assets'),
      text.indexOf('Bypass cache'),
    );
    assert.match(cacheRule, /\/_next\/static\//);
    for (const ext of ['woff2', 'woff', 'ttf', 'otf', 'png', 'jpg', 'webp', 'svg']) {
      assert.ok(cacheRule.includes(`\\"${ext}\\"`), `missing extension ${ext}`);
    }
    assert.doesNotMatch(cacheRule, /\/api|\/app|\/admin|\.html|\.json/);
    assert.match(cacheRule, /cache\s*=\s*true/);
  });

  it('bypasses when a cookie or Authorization header is present, as the last (winning) rule', () => {
    const idx = text.indexOf('Bypass cache');
    assert.ok(
      idx > text.indexOf('Cache hashed static assets'),
      'bypass must come after the cache rule',
    );
    const bypass = text.slice(idx);
    assert.match(bypass, /http\.cookie ne/);
    assert.match(bypass, /authorization/);
    assert.match(bypass, /cache\s*=\s*false/);
  });
});

describe('VPS modules', () => {
  it('reject regions outside India', () => {
    assert.match(mod('vps-do-blr1', 'variables.tf'), /contains\(\["blr1"\], var\.region\)/);
    assert.match(
      mod('vps-lightsail-mumbai', 'variables.tf'),
      /contains\(\["ap-south-1"\], var\.region\)/,
    );
    for (const m of VPS) {
      assert.match(variable(mod(m, 'variables.tf'), 'region').body, /validation\s*\{/);
    }
  });

  it('expose identical outputs so envs can switch provider', () => {
    const [a, b] = VPS.map((m) => outputNames(mod(m, 'outputs.tf')));
    assert.deepEqual(a, b);
    assert.deepEqual(a, ['data_volume_id', 'firewall_id', 'instance_id', 'ipv4', 'ipv6']);
  });

  it('DigitalOcean firewall: world gets only 80 and 443; SSH from the allowlist; no other inbound', () => {
    const fw = blocks(mod('vps-do-blr1', 'main.tf'), 'resource').find(
      (b) => b.labels[0] === 'digitalocean_firewall',
    );
    const rules = nested(fw.body, 'inbound_rule').map((r) => ({
      proto: /protocol\s*=\s*"(\w+)"/.exec(r.body)[1],
      port: /port_range\s*=\s*"([^"]+)"/.exec(r.body)[1],
      world: /anywhere/.test(/source_addresses\s*=\s*(.*)/.exec(r.body)[1]),
      allowlist: /var\.ssh_allowlist/.test(r.body),
    }));
    const world = rules
      .filter((r) => r.world)
      .map((r) => `${r.proto}/${r.port}`)
      .sort();
    assert.deepEqual(world, ['tcp/443', 'tcp/80', 'udp/443']);
    const ssh = rules.filter((r) => r.allowlist);
    assert.deepEqual(
      ssh.map((r) => `${r.proto}/${r.port}`),
      ['tcp/22'],
    );
    assert.equal(rules.length, 4);
    assert.doesNotMatch(
      fw.body,
      /^\s*tags\s*=/m,
      'tags would target droplets, not label the firewall',
    );
  });

  it('Lightsail public ports: world gets only 80 and 443; SSH from the allowlist', () => {
    const ports = blocks(mod('vps-lightsail-mumbai', 'main.tf'), 'resource').find(
      (b) => b.labels[0] === 'aws_lightsail_instance_public_ports',
    );
    const infos = nested(ports.body, 'port_info').map((r) => ({
      key: `${/protocol\s*=\s*"(\w+)"/.exec(r.body)[1]}/${/from_port\s*=\s*(\d+)/.exec(r.body)[1]}`,
      world: /anywhere/.test(/\bcidrs\s*=\s*(.*)/.exec(r.body)[1]),
      allowlist: /local\.ssh_v4/.test(r.body),
    }));
    assert.deepEqual(
      infos
        .filter((i) => i.world)
        .map((i) => i.key)
        .sort(),
      ['tcp/443', 'tcp/80', 'udp/443'],
    );
    assert.deepEqual(
      infos.filter((i) => i.allowlist).map((i) => i.key),
      ['tcp/22'],
    );
    assert.equal(infos.length, 4);
  });

  it('never mention Postgres, MinIO or admin ports in firewall code', () => {
    for (const m of VPS) {
      assert.doesNotMatch(mod(m, 'main.tf'), /\b(5432|9000|9001|9090|3000|3001|3002|8080)\b/, m);
    }
  });

  it('refuse an open SSH allowlist', () => {
    for (const m of VPS) {
      const v = variable(mod(m, 'variables.tf'), 'ssh_allowlist').body;
      assert.match(v, /!contains\(var\.ssh_allowlist, "0\.0\.0\.0\/0"\)/);
      assert.match(v, /!contains\(var\.ssh_allowlist, "::\/0"\)/);
    }
  });

  it('configure a data disk and snapshots, tag everything with data_residency=in', () => {
    const main = (m) => mod(m, 'main.tf');
    assert.match(main('vps-do-blr1'), /digitalocean_volume"\s+"data"/);
    assert.match(main('vps-do-blr1'), /backup_policy\s*\{/);
    assert.match(main('vps-do-blr1'), /tags\s*=\s*local\.do_tags/);
    assert.match(main('vps-lightsail-mumbai'), /aws_lightsail_disk"\s+"data"/);
    assert.match(main('vps-lightsail-mumbai'), /type\s*=\s*"AutoSnapshot"/);
    assert.match(main('vps-lightsail-mumbai'), /tags\s*=\s*var\.tags/);
    for (const m of VPS) {
      const tags = variable(mod(m, 'variables.tf'), 'tags').body;
      for (const k of ['project', 'env', 'owner', 'data_residency'])
        assert.match(tags, new RegExp(`"${k}"`));
      assert.match(tags, /data_residency"\], ""\) == "in"/);
    }
    for (const e of ENVS) {
      const main = read('envs', e, 'main.tf');
      assert.match(main, new RegExp(`env\\s*=\\s*"${e}"`));
      assert.match(main, /data_residency\s*=\s*"in"/);
      assert.match(main, /owner\s*=\s*var\.owner/);
    }
  });

  it('cloud-init runs bootstrap-vps.sh with the variables the script reads', () => {
    const script = readFileSync(path.join(repo, 'infra/scripts/bootstrap-vps.sh'), 'utf8');
    for (const m of VPS) {
      const init = mod(m, 'cloud-init.yaml.tftpl');
      assert.match(init, /bootstrap-vps\.sh/);
      for (const v of ['SSH_ALLOWLIST', 'DEPLOY_PUBKEY']) {
        assert.match(init, new RegExp(v));
        assert.match(script, new RegExp(`\\$\\{${v}:-`));
      }
    }
  });
});

describe('optional Cloudflare modules are off by default', () => {
  it('Access and WAF are count-gated and default to false', () => {
    const access = mod('cloudflare-access', 'main.tf');
    const waf = mod('cloudflare-waf', 'main.tf');
    assert.equal((access.match(/count\s*=\s*var\.enable_access \? 1 : 0/g) ?? []).length, 2);
    assert.equal((waf.match(/count\s*=\s*var\.enable_app_waf \? 1 : 0/g) ?? []).length, 2);
    assert.match(
      variable(mod('cloudflare-access', 'variables.tf'), 'enable_access').body,
      /default\s*=\s*false/,
    );
    assert.match(
      variable(mod('cloudflare-waf', 'variables.tf'), 'enable_app_waf').body,
      /default\s*=\s*false/,
    );
  });

  it('enabling the WAF requires residency_decision_ref in the module and both envs', () => {
    const texts = [
      mod('cloudflare-waf', 'variables.tf'),
      ...ENVS.map((e) => read('envs', e, 'variables.tf')),
    ];
    for (const t of texts) {
      const v = variable(t, 'enable_app_waf');
      assert.match(v.body, /default\s*=\s*false/);
      assert.match(v.body, /validation\s*\{[^}]*residency_decision_ref/s);
    }
  });

  it('envs default app_proxied, enable_app_waf and enable_access to false', () => {
    for (const e of ENVS) {
      const vars = read('envs', e, 'variables.tf');
      for (const name of ['app_proxied', 'enable_app_waf', 'enable_access']) {
        assert.match(variable(vars, name).body, /default\s*=\s*false/, `${e}.${name}`);
      }
      assert.match(
        variable(vars, 'vps_provider').body,
        /contains\(\["do_blr1", "lightsail_mumbai"\]/,
      );
    }
  });
});

describe('Pages and email', () => {
  it('Pages builds apps/site as a static export with production and preview environments', () => {
    const main = mod('cloudflare-pages', 'main.tf');
    assert.match(main, /@causedeck\/site build/);
    assert.match(main, /destination_dir\s*=\s*"apps\/site\/out"/);
    assert.match(main, /production\s*=\s*\{/);
    assert.match(main, /preview\s*=\s*\{/);
    assert.match(main, /site\.\$\{var\.domain\}|var\.domain/);
  });

  it('models SPF, DKIM, DMARC and inbound MX from variables that default to empty', () => {
    const vars = mod('cloudflare-zone', 'variables.tf');
    for (const [name, empty] of [
      ['spf_value', '""'],
      ['dkim_cnames', '{}'],
      ['dmarc_value', '""'],
      ['inbound_mx', '[]'],
    ]) {
      assert.match(
        variable(vars, name).body,
        new RegExp(`default\\s*=\\s*${empty.replace(/[[\]{}]/g, '\\$&')}`),
      );
    }
    const main = mod('cloudflare-zone', 'main.tf');
    for (const t of ['"TXT"', '"CNAME"', '"MX"']) assert.match(main, new RegExp(t));
  });
});

describe('secrets and state', () => {
  it('marks token variables sensitive and keeps credentials out of outputs', () => {
    for (const file of allTf()) {
      const text = readFileSync(file, 'utf8');
      for (const v of blocks(text, 'variable')) {
        if (/token|secret|password/.test(v.labels[0])) {
          assert.match(
            v.body,
            /sensitive\s*=\s*true/,
            `${v.labels[0]} in ${path.relative(tf, file)}`,
          );
        }
      }
      for (const o of blocks(text, 'output')) {
        if (/token|secret|password|var\.cloudflare_api_token/.test(o.body)) {
          assert.match(o.body, /sensitive\s*=\s*true/, `output ${o.labels[0]}`);
        }
      }
    }
  });

  it('example tfvars use dummy values and no real credentials', () => {
    for (const e of ENVS) {
      const t = read('envs', e, 'terraform.tfvars.example');
      assert.match(t, /cloudflare_api_token\s*=\s*"dummy/);
      assert.match(t, /app_proxied\s*=\s*false/);
    }
  });

  it('backend example: India bucket, encryption, locking, no inline credentials', () => {
    const b = read('backend.tf.example');
    assert.match(b, /region\s*=\s*"ap-south-1"/);
    assert.match(b, /encrypt\s*=\s*true/);
    assert.match(b, /use_lockfile\s*=\s*true/);
    assert.doesNotMatch(b, /access_key|secret_key|token\s*=/);
  });

  it('git-ignores state and real tfvars but keeps the examples', () => {
    const ignore = readFileSync(path.join(repo, '.gitignore'), 'utf8');
    for (const line of ['.terraform/', '*.tfstate', '*.tfvars', '!*.tfvars.example']) {
      assert.ok(ignore.split('\n').includes(line), `.gitignore lacks ${line}`);
    }
  });
});

describe('terraform.yml', () => {
  const wf = readFileSync(path.join(repo, '.github/workflows/terraform.yml'), 'utf8');

  it('pins every action by commit SHA and keeps default permissions read-only', () => {
    for (const m of wf.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
    assert.match(wf, /^permissions:\n {2}contents: read\n/m);
  });

  it('runs plan on PRs, drift weekly and apply only manually behind an environment', () => {
    assert.match(wf, /schedule:\n\s+- cron:/);
    assert.match(wf, /-detailed-exitcode/);
    assert.match(wf, /gh pr comment/);
    const apply = wf.slice(wf.indexOf('\n  apply:'));
    assert.match(apply, /if: github\.event_name == 'workflow_dispatch'/);
    assert.match(apply, /environment: terraform-\$\{\{ inputs\.env \}\}/);
    for (const step of ['fmt -check', 'validate', 'tflint', 'checkov', 'terraform test']) {
      assert.ok(wf.includes(step), `missing ${step}`);
    }
    assert.match(wf, /-var-file=terraform\.tfvars\.example/);
    assert.match(wf, /-backend=false/);
  });

  it('README documents cost against the target and the snapshot schedule', () => {
    const readme = read('README.md');
    assert.match(readme, /₹6k to 12k/);
    assert.match(readme, /Sunday 20:00 UTC/);
    assert.ok(existsSync(path.join(tf, 'envs', 'prod', 'tests', 'residency.tftest.hcl')));
  });
});
