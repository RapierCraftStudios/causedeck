-- Migration 0019_audit_jobs: hand-written (no schema diff for drizzle-kit), reviewed before commit.
-- Reviewed-by: Claude (agent, #230)
-- Cross-tenant reads for the nightly `system.audit.verify` job (#230, #26 part 5). The job has no
-- workspace, and audit_event is under FORCE row-level security (0008_audit), so it reads through
-- owner-defined SECURITY DEFINER functions, the same pattern as app_billing_reconcile_targets
-- (0007). owner_definer_read on audit_event (0008) already lets the owner read every row.
--   * app_audit_chain_targets() returns ids only: every workspace with an audit chain, deleted
--     workspaces included (audit_event has no foreign key to organization). The per-workspace
--     `audit.verify` job then runs verifyChain inside withWorkspace, under ws_isolation.
--   * app_audit_verify_account_chain(from, to) verifies the account chain (workspace_id null),
--     which the app role can read only as each event's actor (account_self). It is the window
--     query of verifyChain (packages/core/src/audit/chain.ts) and returns only a count, the id of
--     the first broken event and the reason, never row content.
--   * Additive only; the previous release never calls the functions.
CREATE FUNCTION app_audit_chain_targets()
  RETURNS TABLE (workspace_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT a.workspace_id FROM audit_event a
    WHERE a.workspace_id IS NOT NULL
    ORDER BY a.workspace_id
  $$;--> statement-breakpoint
CREATE FUNCTION app_audit_verify_account_chain(p_from timestamptz, p_to timestamptz)
  RETURNS TABLE (checked int, id uuid, reason text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH c AS (
      SELECT a.id, a.created_at,
             a.hash = sha256(coalesce(a.prev_hash, ''::bytea)
                             || convert_to(app_audit_canonical(a)::text, 'UTF8')) AS hash_ok,
             CASE WHEN row_number() OVER w = 1
                  THEN p_from IS NOT NULL OR a.prev_hash IS NULL
                  ELSE a.prev_hash IS NOT DISTINCT FROM lag(a.hash) OVER w END AS link_ok
      FROM audit_event a
      WHERE a.workspace_id IS NULL
        AND (p_from IS NULL OR a.created_at >= p_from)
        AND (p_to IS NULL OR a.created_at < p_to)
      WINDOW w AS (ORDER BY a.created_at, a.id)
    )
    SELECT n.checked, b.id, b.reason
    FROM (SELECT count(*)::int AS checked FROM c) n
    LEFT JOIN LATERAL (
      SELECT c.id, CASE WHEN NOT c.hash_ok THEN 'hash' ELSE 'link' END AS reason
      FROM c WHERE NOT c.hash_ok OR NOT c.link_ok
      ORDER BY c.created_at, c.id LIMIT 1
    ) b ON true
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_audit_chain_targets(),
  app_audit_verify_account_chain(timestamptz, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_audit_chain_targets(),
  app_audit_verify_account_chain(timestamptz, timestamptz) TO causedeck_app;
