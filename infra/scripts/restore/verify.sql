-- Restore drill verification (#101). Run by restore-drill.sh inside the restored instance as the
-- superuser, after the script created and filled `drill_manifest(tbl text, rows bigint)` and set the
-- psql variable `tolerance` (fraction of rows a table may have lost since the manifest, default 0).
-- Prints one line per check: `CHECK|<name>|<t|f>|<detail>`; the script turns them into the JSON
-- report and any `f` fails the drill. The same file is reusable against an RDS restore (#106).
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'

-- 1. amcheck: every valid btree index in public is structurally sound.
create extension if not exists amcheck;
select 'CHECK', 'amcheck',
       case when count(*) filter (where not ok) = 0 then 't' else 'f' end,
       count(*)::text || ' indexes checked, ' || count(*) filter (where not ok)::text || ' failed'
  from (
    select c.oid, (select true from (select bt_index_check(c.oid, true)) s) as ok
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join pg_am am on am.oid = c.relam and am.amname = 'btree'
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where i.indisvalid
  ) x;

-- 2. Row counts against the manifest taken at backup time. A table missing from the restore, or
-- with fewer rows than the manifest allows, fails the check.
with actual as (
  select m.tbl, m.rows as expected,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', m.tbl), false, true, '')))[1]::text::bigint as got
    from drill_manifest m
   where to_regclass(format('public.%I', m.tbl)) is not null
), missing as (
  select m.tbl from drill_manifest m where to_regclass(format('public.%I', m.tbl)) is null
)
select 'CHECK', 'row_counts',
       case when (select count(*) from drill_manifest) > 0
             and not exists (select 1 from missing)
             and not exists (select 1 from actual where got < floor(expected * (1 - :'tolerance'::numeric)))
            then 't' else 'f' end,
       (select count(*) from drill_manifest)::text || ' tables in manifest, '
         || (select count(*) from missing)::text || ' missing, '
         || (select count(*) from actual where got < floor(expected * (1 - :'tolerance'::numeric)))::text || ' short';

-- 3. RLS is enabled and forced on every table that has a workspace_id column.
select 'CHECK', 'rls_enabled',
       case when count(*) > 0 and count(*) filter (where not (c.relrowsecurity and c.relforcerowsecurity)) = 0
            then 't' else 'f' end,
       count(*)::text || ' tenant tables, '
         || count(*) filter (where not (c.relrowsecurity and c.relforcerowsecurity))::text || ' without enabled+forced RLS'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
 where c.relkind = 'r'
   and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped);

-- 4. Cross-tenant canary: as the app role scoped to workspace A, no tenant table returns a row of
-- workspace B. Picks two workspaces that own rows in workspace_key; passes (with a note) when the
-- restore holds fewer than two.
do $$
declare
  a uuid; b uuid; leaked bigint := 0; t text; n bigint; tables int := 0;
begin
  select workspace_id into a from public.workspace_key order by workspace_id limit 1;
  select workspace_id into b from public.workspace_key order by workspace_id desc limit 1;
  if a is null or a = b then
    perform set_config('drill.cross_tenant', 't|fewer than two workspaces in the restore: nothing to cross', false);
    return;
  end if;
  set local role causedeck_app;
  perform set_config('app.workspace_id', a::text, true);
  for t in
    select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute x where x.attrelid = c.oid and x.attname = 'workspace_id' and not x.attisdropped)
  loop
    execute format('select count(*) from public.%I where workspace_id = %L', t, b) into n;
    leaked := leaked + n;
    tables := tables + 1;
  end loop;
  reset role;
  perform set_config('drill.cross_tenant', case when leaked = 0 then 't' else 'f' end
                     || '|' || leaked::text || ' foreign rows visible across ' || tables::text || ' tables', false);
end $$;
select 'CHECK', 'cross_tenant', split_part(current_setting('drill.cross_tenant'), '|', 1),
       split_part(current_setting('drill.cross_tenant'), '|', 2);

-- 5. Crypto-erase: a destroyed workspace key holds no key material (all bytes zero), so a restore
-- from any backup taken after the erase cannot recover that workspace's DEK.
select 'CHECK', 'crypto_erase',
       case when count(*) filter (where ltrim(encode(wrapped_dek, 'hex'), '0') <> '') = 0 then 't' else 'f' end,
       count(*)::text || ' destroyed keys, '
         || count(*) filter (where ltrim(encode(wrapped_dek, 'hex'), '0') <> '')::text || ' with key material'
  from public.workspace_key
 where destroyed_at is not null;
