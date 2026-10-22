-- Run LeLibrary as a normal database login instead of the Postgres superuser.
--
-- Creates (or updates) the login `lelibrary_app` with no superuser, create-
-- database or create-role rights, and makes it the owner of this database and
-- every LeLibrary table, so the app's own startup migrations keep working.
-- Safe to run more than once. Nothing is deleted.
--
-- The password comes from the DB_APP_PASSWORD environment variable, so it never
-- appears on a command line or in logs. Run as the existing superuser:
--
--   set -a; . ./.env; set +a
--   docker compose exec -T -e DB_APP_PASSWORD postgres \
--     psql -v ON_ERROR_STOP=1 -U lelibrary -d lelibrary < selfhost/postgres-app-role.sql
--
-- Then point DATABASE_URL at the new login (see SETUP.md) and restart LeLibrary.

\set ON_ERROR_STOP on
\set app_role lelibrary_app
\getenv app_password DB_APP_PASSWORD
SELECT :'app_password' IS NULL OR length(:'app_password') < 16 AS weak_password \gset
\if :weak_password
  \echo 'DB_APP_PASSWORD is missing or shorter than 16 characters. Nothing was changed.'
  \quit
\endif

BEGIN;

SELECT format('CREATE ROLE %I LOGIN', :'app_role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
              :'app_role', :'app_password') \gexec

-- The app owns its database and schema (it creates and alters its own tables
-- at startup), and every existing LeLibrary table, view and sequence.
SELECT format('ALTER DATABASE %I OWNER TO %I', current_database(), :'app_role') \gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'app_role') \gexec
SELECT format('ALTER TABLE %I.%I OWNER TO %I', schemaname, tablename, :'app_role')
  FROM pg_tables WHERE schemaname = 'public' \gexec
SELECT format('ALTER VIEW %I.%I OWNER TO %I', schemaname, viewname, :'app_role')
  FROM pg_views WHERE schemaname = 'public' \gexec
-- Sequences that belong to a table column move with their table above; this
-- catches any standalone ones.
SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I', n.nspname, c.relname, :'app_role')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'S' AND n.nspname = 'public'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')) \gexec

COMMIT;

\echo 'Done: lelibrary_app now owns this database. Update DATABASE_URL and restart LeLibrary.'
