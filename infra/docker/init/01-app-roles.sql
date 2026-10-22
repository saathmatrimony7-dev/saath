-- Local Docker dev ONLY: enable the non-superuser app login role.
-- Cloud environments create/enable this role out-of-band with a password from
-- AWS Secrets Manager — never with a password committed to git.
-- Runs once at container init (before migrations apply table grants).
CREATE ROLE app_user NOLOGIN;
CREATE ROLE app_login LOGIN NOSUPERUSER PASSWORD 'app_login_dev_password' IN ROLE app_user;
