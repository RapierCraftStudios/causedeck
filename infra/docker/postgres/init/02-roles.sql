-- Roles for row-level security (#19). Passwords are local dev defaults only; never use them in
-- staging or production.
--   causedeck_owner: owns the database and schema `public`; runs migrations (DATABASE_URL_OWNER).
--   causedeck_app:   what the apps connect as (DATABASE_URL). Not an owner, cannot bypass RLS and
--                    cannot create objects in `public`.
--   causedeck_clerk: no login; `withWorkspace({ dbRole: 'clerk' })` switches the app role to it
--                    (SET LOCAL ROLE) for clerk members (#233). Migration 0016 gives it the app role's
--                    privileges minus the base tables behind clerk views (`app_clerk_view`).
CREATE ROLE causedeck_owner LOGIN PASSWORD 'causedeck_owner';
CREATE ROLE causedeck_app LOGIN PASSWORD 'causedeck_app'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;

ALTER DATABASE causedeck OWNER TO causedeck_owner;
ALTER SCHEMA public OWNER TO causedeck_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO causedeck_app;
CREATE ROLE causedeck_clerk NOLOGIN
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT USAGE ON SCHEMA public TO causedeck_clerk;
-- The app role may SET ROLE to the clerk (it does not inherit the clerk's privileges, nor the reverse).
GRANT causedeck_clerk TO causedeck_app;

-- Tables and sequences the owner creates (migrations) are usable by the app role.
ALTER DEFAULT PRIVILEGES FOR ROLE causedeck_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO causedeck_app;
ALTER DEFAULT PRIVILEGES FOR ROLE causedeck_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO causedeck_app;
