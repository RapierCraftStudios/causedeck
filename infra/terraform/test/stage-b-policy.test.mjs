// Static policy lint for the Stage B modules (#106): `node --test infra/terraform/test/stage-b-policy.test.mjs`.
// Plain-text checks like policy.test.mjs (no HCL parser, no Terraform needed); validate, plan and
// checkov run in .github/workflows/terraform.yml.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const tf = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(tf, ...p), 'utf8');
const mod = (name, file = 'main.tf') => read('modules', name, file);
const STAGE_B_MODULES = [
  'aws-rds-postgres',
  'aws-s3-documents',
  'aws-alb-multinode',
  'cloudflare-lb',
  'aws-ecs-fargate',
  'aws-elasticache',
];
const AWS_MODULES = STAGE_B_MODULES.filter((m) => m.startsWith('aws-'));

// Top-level blocks `kind "a" "b" { ... }` using brace matching.
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
const resource = (text, type, name) =>
  blocks(text, 'resource').find((b) => b.labels[0] === type && (!name || b.labels[1] === name));
const variable = (text, name) => blocks(text, 'variable').find((b) => b.labels[0] === name);
const files = (dir) => {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(full));
    else if (e.name.endsWith('.tf')) out.push(full);
  }
  return out;
};

describe('every Stage B module exists with a README and the standard files', () => {
  for (const name of STAGE_B_MODULES) {
    it(name, () => {
      for (const f of ['main.tf', 'variables.tf', 'outputs.tf', 'versions.tf', 'README.md']) {
        assert.ok(read('modules', name, f).length > 0, `${name}/${f} is empty`);
      }
    });
  }
});

describe('India regions only', () => {
  for (const name of AWS_MODULES) {
    it(`${name}: region is validated to ap-south-1 and ap-south-2`, () => {
      const v = variable(mod(name, 'variables.tf'), 'region');
      assert.ok(v, 'region variable missing');
      assert.match(v.body, /contains\(\["ap-south-1", "ap-south-2"\], var\.region\)/);
    });
  }

  it('replica regions are validated too (rds, s3, stage-b env)', () => {
    for (const file of [
      mod('aws-rds-postgres', 'variables.tf'),
      mod('aws-s3-documents', 'variables.tf'),
    ]) {
      assert.match(
        variable(file, 'replica_region').body,
        /contains\(\["ap-south-1", "ap-south-2"\], var\.replica_region\)/,
      );
    }
    const env = read('envs', 'stage-b', 'variables.tf');
    assert.match(variable(env, 'aws_region').body, /contains\(\["ap-south-1", "ap-south-2"\]/);
    assert.match(variable(env, 'replica_region').body, /contains\(\["ap-south-1", "ap-south-2"\]/);
  });

  it('no non-India AWS region appears anywhere in the Stage B files', () => {
    const stageB = [
      ...STAGE_B_MODULES.flatMap((m) => files(path.join(tf, 'modules', m))),
      ...files(path.join(tf, 'envs', 'stage-b')),
    ];
    for (const f of stageB) {
      assert.doesNotMatch(
        readFileSync(f, 'utf8'),
        /\b(us|eu|ap-(?!south-[12])[a-z]+|sa|ca|me|af)-[a-z]+-\d\b/,
        `${path.relative(tf, f)} names a region outside India`,
      );
    }
  });

  it('providers are checked against the validated region variables', () => {
    for (const name of ['aws-rds-postgres', 'aws-s3-documents']) {
      const text = mod(name);
      assert.match(text, /data\.aws_region\.primary\.region == var\.region/);
      assert.match(text, /data\.aws_region\.replica\.region == var\.replica_region/);
    }
  });
});

describe('aws-rds-postgres', () => {
  const text = mod('aws-rds-postgres');
  const primary = resource(text, 'aws_db_instance', 'primary').body;
  const replica = resource(text, 'aws_db_instance', 'replica').body;

  it('encrypts with a customer-managed KMS key with rotation', () => {
    assert.match(primary, /storage_encrypted\s*=\s*true/);
    assert.match(primary, /kms_key_id\s*=\s*aws_kms_key\.primary\.arn/);
    assert.match(resource(text, 'aws_kms_key', 'primary').body, /enable_key_rotation\s*=\s*true/);
    assert.match(replica, /storage_encrypted\s*=\s*true/);
    assert.match(replica, /kms_key_id\s*=\s*aws_kms_key\.replica\.arn/);
  });

  it('separates key administrators from key users', () => {
    assert.match(text, /sid\s*=\s*"Administer"/);
    assert.match(text, /sid\s*=\s*"Use"/);
    assert.match(text, /identifiers\s*=\s*local\.key_admins/);
    assert.match(text, /identifiers\s*=\s*local\.key_users/);
  });

  it('keeps automated backups (PITR) on', () => {
    assert.match(primary, /backup_retention_period\s*=\s*var\.backup_retention_days/);
    const v = variable(mod('aws-rds-postgres', 'variables.tf'), 'backup_retention_days');
    assert.match(v.body, /var\.backup_retention_days >= 7/);
  });

  it('has a read replica in the replica provider (Hyderabad) sourced from the primary', () => {
    assert.match(replica, /provider\s*=\s*aws\.replica/);
    assert.match(replica, /replicate_source_db\s*=\s*aws_db_instance\.primary\.arn/);
    assert.equal(
      variable(mod('aws-rds-postgres', 'variables.tf'), 'replica_region').body.match(
        /default\s*=\s*"([^"]+)"/,
      )[1],
      'ap-south-2',
    );
  });

  it('has a pgvector-capable parameter group that forces TLS', () => {
    const pg = resource(text, 'aws_db_parameter_group', 'postgres').body;
    assert.match(pg, /family\s*=\s*"postgres\$\{var\.engine_version\}"/);
    assert.match(pg, /rds\.force_ssl/);
    assert.match(mod('aws-rds-postgres', 'outputs.tf'), /"vector"/);
    assert.match(mod('aws-rds-postgres', 'variables.tf'), /pgvector/);
  });

  it('has no public endpoint and no CIDR ingress', () => {
    assert.match(primary, /publicly_accessible\s*=\s*false/);
    assert.match(replica, /publicly_accessible\s*=\s*false/);
    assert.doesNotMatch(text, /publicly_accessible\s*=\s*true/);
    assert.doesNotMatch(text, /cidr_ipv4|cidr_blocks|0\.0\.0\.0\/0/);
    assert.match(text, /referenced_security_group_id/);
  });

  it('never takes a password in a variable', () => {
    assert.match(primary, /manage_master_user_password\s*=\s*true/);
    assert.doesNotMatch(mod('aws-rds-postgres', 'variables.tf'), /variable "(master_)?password"/);
  });
});

describe('aws-s3-documents', () => {
  const text = mod('aws-s3-documents');

  it('blocks public access on both buckets', () => {
    for (const name of ['documents', 'replica']) {
      const b = resource(text, 'aws_s3_bucket_public_access_block', name).body;
      for (const k of [
        'block_public_acls',
        'block_public_policy',
        'ignore_public_acls',
        'restrict_public_buckets',
      ]) {
        assert.match(b, new RegExp(`${k}\\s*=\\s*true`));
      }
    }
  });

  it('enables versioning and SSE-KMS', () => {
    assert.match(
      resource(text, 'aws_s3_bucket_versioning', 'documents').body,
      /status\s*=\s*"Enabled"/,
    );
    const sse = resource(
      text,
      'aws_s3_bucket_server_side_encryption_configuration',
      'documents',
    ).body;
    assert.match(sse, /sse_algorithm\s*=\s*"aws:kms"/);
    assert.match(sse, /kms_master_key_id\s*=\s*aws_kms_key\.primary\.arn/);
    assert.match(resource(text, 'aws_kms_key', 'primary').body, /enable_key_rotation\s*=\s*true/);
  });

  it('applies per-workspace prefix IAM conditions on ws/<workspace_id>/', () => {
    assert.match(text, /\/ws\/\$\$\{aws:PrincipalTag\/workspace_id\}\/\*/);
    assert.match(text, /variable\s*=\s*"s3:prefix"/);
    assert.match(text, /values\s*=\s*\["ws\/\$\$\{aws:PrincipalTag\/workspace_id\}\/\*"\]/);
  });

  it('replicates to the second India region, versioned and encrypted', () => {
    const r = resource(text, 'aws_s3_bucket_replication_configuration', 'documents').body;
    assert.match(r, /bucket\s*=\s*aws_s3_bucket\.replica\.arn/);
    assert.match(r, /replica_kms_key_id\s*=\s*aws_kms_key\.replica\.arn/);
    assert.match(
      resource(text, 'aws_s3_bucket_versioning', 'replica').body,
      /status\s*=\s*"Enabled"/,
    );
    assert.match(resource(text, 'aws_s3_bucket', 'replica').body, /provider\s*=\s*aws\.replica/);
    const v = variable(mod('aws-s3-documents', 'variables.tf'), 'replica_region');
    assert.match(v.body, /var\.replica_region != var\.region/);
  });

  it('denies plain HTTP', () => {
    assert.match(text, /aws:SecureTransport/);
  });
});

describe('aws-alb-multinode', () => {
  const text = mod('aws-alb-multinode');

  it('health-checks /readyz and terminates TLS', () => {
    assert.match(
      variable(mod('aws-alb-multinode', 'variables.tf'), 'health_check_path').body,
      /default\s*=\s*"\/readyz"/,
    );
    assert.match(
      resource(text, 'aws_lb_target_group', 'app').body,
      /path\s*=\s*var\.health_check_path/,
    );
    assert.match(resource(text, 'aws_lb_listener', 'https').body, /protocol\s*=\s*"HTTPS"/);
  });

  it('keeps the WAF off by default', () => {
    const v = variable(mod('aws-alb-multinode', 'variables.tf'), 'enable_waf');
    assert.match(v.body, /default\s*=\s*false/);
    assert.match(
      resource(text, 'aws_wafv2_web_acl_association', 'app').body,
      /count\s*=\s*var\.enable_waf \? 1 : 0/,
    );
  });
});

describe('cloudflare-lb is gated by the residency decision', () => {
  const vars = mod('cloudflare-lb', 'variables.tf');
  const main = mod('cloudflare-lb');

  it('cannot be enabled without residency_decision_ref and approval_doc', () => {
    const v = variable(vars, 'enable_cloudflare_lb');
    assert.match(v.body, /default\s*=\s*false/);
    assert.match(v.body, /residency_decision_ref/);
    assert.match(v.body, /approval_doc/);
    assert.match(v.body, /error_message/);
  });

  it('creates nothing unless enabled and is DNS-only by default', () => {
    for (const b of blocks(main, 'resource')) {
      assert.match(b.body, /count\s*=\s*var\.enable_cloudflare_lb \? 1 : 0/, b.labels.join('.'));
    }
    const proxied = variable(vars, 'proxied');
    assert.match(proxied.body, /default\s*=\s*false/);
    assert.match(proxied.body, /residency_decision_ref/);
  });

  it('is off in the stage-b env example and the ALB is wired in', () => {
    const env = read('envs', 'stage-b', 'main.tf');
    assert.match(env, /module "alb"/);
    assert.match(
      read('envs', 'stage-b', 'terraform.tfvars.example'),
      /enable_cloudflare_lb\s*=\s*false/,
    );
    assert.match(
      variable(read('envs', 'stage-b', 'variables.tf'), 'enable_cloudflare_lb').body,
      /default\s*=\s*false/,
    );
  });
});

describe('Stage C skeletons are disabled by default', () => {
  for (const name of ['aws-ecs-fargate', 'aws-elasticache']) {
    it(name, () => {
      assert.match(variable(mod(name, 'variables.tf'), 'enabled').body, /default\s*=\s*false/);
      for (const b of blocks(mod(name), 'resource')) {
        assert.match(b.body, /count\s*=\s*var\.enabled \? 1 : 0/, b.labels.join('.'));
      }
    });
  }

  it('stage-b env keeps Stage C off', () => {
    assert.match(
      variable(read('envs', 'stage-b', 'variables.tf'), 'enable_stage_c').body,
      /default\s*=\s*false/,
    );
    assert.match(read('envs', 'stage-b', 'terraform.tfvars.example'), /enable_stage_c\s*=\s*false/);
  });
});

describe('nothing applies automatically', () => {
  const wf = readFileSync(
    path.join(tf, '..', '..', '.github', 'workflows', 'terraform.yml'),
    'utf8',
  );

  it('stage-b is validated and planned on pull requests only', () => {
    assert.match(wf, /for env in staging prod stage-b/);
    assert.match(wf, /env: \[staging, prod, stage-b\]/);
  });

  it('apply stays workflow_dispatch behind the terraform-<env> environment and never targets stage-b', () => {
    const apply = wf.slice(wf.indexOf('  apply:'));
    assert.match(apply, /if: github\.event_name == 'workflow_dispatch'/);
    assert.match(apply, /environment: terraform-\$\{\{ inputs\.env \}\}/);
    assert.match(wf, /options: \[staging, prod\]/);
    assert.doesNotMatch(apply, /stage-b/);
    assert.doesNotMatch(wf.slice(wf.indexOf('  drift:'), wf.indexOf('  apply:')), /stage-b/);
  });

  it('the stage-b env commits no backend and no provider credentials', () => {
    const all = files(path.join(tf, 'envs', 'stage-b'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    assert.doesNotMatch(all, /backend\s+"/);
    assert.doesNotMatch(all, /access_key|secret_key/);
  });
});

describe('OVH Stage B root (#887)', () => {
  const root = (f) => read('envs', 'stage-b-ovh', f);
  const wf = readFileSync(
    path.join(tf, '..', '..', '.github', 'workflows', 'terraform.yml'),
    'utf8',
  );

  it('orders a db primary, a db replica and N app nodes through the OVH module only', () => {
    const main = root('main.tf');
    const mods = blocks(main, 'module');
    assert.deepEqual(mods.map((m) => m.labels[0]).sort(), ['app', 'db_primary', 'db_replica']);
    for (const m of mods)
      assert.match(m.body, /source\s*=\s*"\.\.\/\.\.\/modules\/vps-ovh-mumbai"/);
    assert.match(main, /provider "ovh" \{\}/);
  });

  it('keeps for_each keys plan-time known: derived from a variable only', () => {
    const main = root('main.tf');
    assert.match(main, /for_each\s*=\s*local\.app_nodes/);
    assert.match(
      main,
      /app_nodes\s*=\s*toset\(\[for i in range\(var\.app_node_count\) : tostring\(i \+ 1\)\]\)/,
    );
    assert.doesNotMatch(main, /for_each\s*=\s*[^\n]*module\./);
  });

  it('every node uses the YNM-only datacenter variable; nothing hardcodes another datacenter', () => {
    const main = root('main.tf');
    const dcs = [...main.matchAll(/datacenter\s*=\s*(\S+)/g)].map((m) => m[1]);
    assert.equal(dcs.length, 3);
    for (const d of dcs) assert.equal(d, 'var.vps_datacenter');
    const v = variable(root('variables.tf'), 'vps_datacenter').body;
    assert.match(v, /default\s*=\s*"YNM"/);
    assert.match(v, /contains\(\["YNM"\], var\.vps_datacenter\)/);
    assert.doesNotMatch(main, /"(GRA|SBG|RBX|WAW|BHS|SGP|SYD)"/);
  });

  it('needs at least two app nodes', () => {
    const v = variable(root('variables.tf'), 'app_node_count').body;
    assert.match(v, /default\s*=\s*2/);
    assert.match(v, /var\.app_node_count >= 2/);
  });

  it('commits no backend and no credentials, and the example holds none', () => {
    const all = files(path.join(tf, 'envs', 'stage-b-ovh'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    assert.doesNotMatch(
      all,
      /backend\s+"|access_key|secret_key|application_(key|secret)\s*=|consumer_key\s*=/,
    );
    assert.doesNotMatch(
      root('terraform.tfvars.example'),
      /^\s*(OVH_\w+|\w*(key|secret|token)\w*)\s*=/im,
    );
  });

  it('is validated and tested in CI but never planned, drifted or applied', () => {
    assert.match(wf, /for env in staging prod stage-b stage-b-ovh/);
    assert.match(wf, /\/repo\/infra\/terraform\/envs\/stage-b-ovh\s*\\\n\s+"\$TF_IMAGE" test/);
    assert.match(wf, /env: \[staging, prod, stage-b\]\n/);
    assert.doesNotMatch(wf.slice(wf.indexOf('  drift:')), /stage-b-ovh/);
  });

  it('the AWS variant stays plan-only and the ADR names both paths', () => {
    assert.match(wf, /env: \[staging, prod, stage-b\]\n/);
    const adr = readFileSync(
      path.join(tf, '..', '..', 'docs', 'adr', '0053-stage-b-c-scale-path.md'),
      'utf8',
    );
    assert.match(adr, /OVH Mumbai/);
    assert.match(adr, /Optional AWS path/);
    assert.match(adr, /^## Revisit when$/m);
  });
});
