-- 0037: el login migra de Auth0 a Supabase Auth — la columna de lookup del
-- sub externo deja de ser específica de Auth0. users.id (uuid propio) sigue
-- siendo el id interno de TODAS las FKs; auth_sub guarda el sub de Supabase
-- (uuid de auth.users), los subs legacy "auth0|..." y los sintéticos
-- "demo|..." del checkout anónimo. Mirror a test_schema.
ALTER TABLE public.users RENAME COLUMN auth0_sub TO auth_sub;
ALTER TABLE test_schema.users RENAME COLUMN auth0_sub TO auth_sub;
COMMENT ON COLUMN public.users.auth_sub IS 'Sub del proveedor de identidad (Supabase Auth uuid; legacy auth0|…; demo|… del checkout anónimo). Solo clave de lookup — el id interno es users.id.';
