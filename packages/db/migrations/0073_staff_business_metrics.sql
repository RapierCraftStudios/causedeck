-- Migration 0070_staff_business_metrics: hand-written (functions and grants only, no table change); the snapshot repeats 0069's schema, reviewed before commit.
-- Reviewed-by: Claude (agent, #519)
-- The internal business dashboard's reads (#519, D-049):
--   * app_business_snapshot(period, as_of) is SECURITY DEFINER and returns one jsonb document of
--     aggregates per plan: subscribers and MRR, new and churned subscriptions in the last 30 days,
--     active users by plan (sessions touched in the last 1, 7 and 30 days), the period's
--     `ai.spend_paise`, and the period's fetch_log cost split into captcha and other tiers. Delegated
--     lookups are attributed to the advocate's plan; every other fetch is shared platform cost.
--     It returns numbers and plan ids only, never an email, a workspace id or any content. The
--     owner already reads subscription, member and usage_counter through owner_definer_read.
--     Like app_usage_rollup_targets (0018) it is callable by the app role, so the daily alert and
--     weekly digest jobs (no staff user) can use it.
--   * app_staff_business_snapshot(period, as_of) first refuses (42501) unless app.user_id is an
--     enabled staff_user (app_staff_require_caller, 0033), then returns the same document. The
--     staff console reads only this one.
-- Additive only; the previous release never calls the functions.
CREATE FUNCTION app_business_snapshot(period timestamptz, as_of timestamptz)
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH live AS (
      SELECT s.workspace_id, s.plan_id, s.seats, s.clerk_seats, s.created_at
        FROM subscription s
       WHERE s.status NOT IN ('cancelled', 'expired')
    ),
    user_plan AS (
      SELECT DISTINCT ON (m.user_id) m.user_id, l.plan_id
        FROM member m
        JOIN live l ON l.workspace_id = m.workspace_id
        JOIN plan p ON p.id = l.plan_id
       WHERE m.status = 'active'
       ORDER BY m.user_id, p.price_paise DESC, l.plan_id
    ),
    seen AS (
      SELECT s.user_id, max(s.updated_at) AS last_seen
        FROM session s
       WHERE s.updated_at >= as_of - interval '30 days'
       GROUP BY s.user_id
    ),
    subs AS (
      SELECT l.plan_id,
             count(*) AS subscribers,
             coalesce(sum(l.seats), 0) AS seats,
             coalesce(sum(
               (CASE WHEN p.per_seat THEN p.price_paise * l.seats ELSE p.price_paise END
                  + coalesce(p.clerk_seat_price_paise, 0) * l.clerk_seats)::numeric
               / CASE WHEN p.interval = 'year' THEN 12 ELSE 1 END), 0) AS mrr_paise,
             count(*) FILTER (WHERE l.created_at >= as_of - interval '30 days') AS new_30d
        FROM live l JOIN plan p ON p.id = l.plan_id
       GROUP BY l.plan_id
    ),
    churned AS (
      SELECT s.plan_id, count(*) AS churned_30d
        FROM subscription s
       WHERE s.status IN ('cancelled', 'expired') AND s.updated_at >= as_of - interval '30 days'
       GROUP BY s.plan_id
    ),
    users AS (
      SELECT up.plan_id,
             count(*) FILTER (WHERE sn.last_seen >= as_of - interval '1 day') AS dau,
             count(*) FILTER (WHERE sn.last_seen >= as_of - interval '7 days') AS wau,
             count(*) AS mau
        FROM seen sn JOIN user_plan up ON up.user_id = sn.user_id
       GROUP BY up.plan_id
    ),
    ai AS (
      SELECT l.plan_id, coalesce(sum(c.value), 0) AS ai_spend_paise
        FROM usage_counter c JOIN live l ON l.workspace_id = c.workspace_id
       WHERE c.key = 'ai.spend_paise' AND c.period_start = period
       GROUP BY l.plan_id
    ),
    fetched AS (
      SELECT up.plan_id,
             coalesce(sum(f.cost_dollars) FILTER (WHERE f.tier IS DISTINCT FROM 'captcha'), 0) AS fetch_dollars,
             coalesce(sum(f.cost_dollars) FILTER (WHERE f.tier = 'captcha'), 0) AS captcha_dollars
        FROM fetch_log f JOIN user_plan up ON up.user_id::text = f.delegated_advocate_id
       WHERE f.fetched_at >= period
       GROUP BY up.plan_id
    ),
    shared AS (
      SELECT coalesce(sum(f.cost_dollars) FILTER (WHERE f.tier IS DISTINCT FROM 'captcha'), 0) AS fetch_dollars,
             coalesce(sum(f.cost_dollars) FILTER (WHERE f.tier = 'captcha'), 0) AS captcha_dollars
        FROM fetch_log f
       WHERE f.fetched_at >= period
         AND NOT EXISTS (SELECT 1 FROM user_plan up WHERE up.user_id::text = f.delegated_advocate_id)
    )
    SELECT jsonb_build_object(
      'plans', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'planId', p.id,
                 'name', p.name,
                 'pricePaise', p.price_paise,
                 'subscribers', coalesce(subs.subscribers, 0),
                 'seats', coalesce(subs.seats, 0),
                 'mrrPaise', coalesce(subs.mrr_paise, 0),
                 'new30d', coalesce(subs.new_30d, 0),
                 'churned30d', coalesce(churned.churned_30d, 0),
                 'dau', coalesce(users.dau, 0),
                 'wau', coalesce(users.wau, 0),
                 'mau', coalesce(users.mau, 0),
                 'aiSpendPaise', coalesce(ai.ai_spend_paise, 0),
                 'fetchDollars', coalesce(fetched.fetch_dollars, 0),
                 'captchaDollars', coalesce(fetched.captcha_dollars, 0)
               ) ORDER BY p.price_paise, p.id)
          FROM plan p
          LEFT JOIN subs ON subs.plan_id = p.id
          LEFT JOIN churned ON churned.plan_id = p.id
          LEFT JOIN users ON users.plan_id = p.id
          LEFT JOIN ai ON ai.plan_id = p.id
          LEFT JOIN fetched ON fetched.plan_id = p.id
         WHERE subs.plan_id IS NOT NULL OR churned.plan_id IS NOT NULL OR users.plan_id IS NOT NULL
            OR ai.plan_id IS NOT NULL OR fetched.plan_id IS NOT NULL
      ), '[]'::jsonb),
      'shared', (SELECT jsonb_build_object('fetchDollars', fetch_dollars, 'captchaDollars', captcha_dollars) FROM shared)
    )
  $$;--> statement-breakpoint
CREATE FUNCTION app_staff_business_snapshot(period timestamptz, as_of timestamptz)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    BEGIN
      PERFORM app_staff_require_caller();
      RETURN app_business_snapshot(period, as_of);
    END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_business_snapshot(timestamptz, timestamptz), app_staff_business_snapshot(timestamptz, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_business_snapshot(timestamptz, timestamptz) TO causedeck_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_staff_business_snapshot(timestamptz, timestamptz) TO causedeck_app, causedeck_clerk;
