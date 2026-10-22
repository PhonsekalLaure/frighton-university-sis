-- Preserve signed avatar URLs in student profiles, but never retain their
-- credentials, query parameters, or fragments in append-only audit snapshots.
BEGIN;

CREATE FUNCTION private.admin_audit_url(p_value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'string' THEN
    to_jsonb(regexp_replace(
      regexp_replace(p_value #>> '{}', '[?#].*$', '', 's'),
      '^(https?://)[^/?#]*@', '\1', 'i'))
    ELSE 'null'::jsonb END;
$$;

-- Sanitize at insertion so every audit producer, including direct service-role
-- inserts, gets the same protection. Existing append-only history stays intact.
CREATE FUNCTION private.redact_admin_audit_urls() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.target ? 'avatarUrl' THEN
    NEW.target := jsonb_set(NEW.target, '{avatarUrl}', private.admin_audit_url(NEW.target->'avatarUrl'));
  END IF;
  IF NEW.changes ? 'avatarUrl' THEN
    NEW.changes := jsonb_set(NEW.changes, '{avatarUrl}', jsonb_build_object(
      'before', private.admin_audit_url(NEW.changes->'avatarUrl'->'before'),
      'after', private.admin_audit_url(NEW.changes->'avatarUrl'->'after')));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.admin_audit_url(jsonb), private.redact_admin_audit_urls()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER admin_audit_logs_redact_urls BEFORE INSERT ON public.admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION private.redact_admin_audit_urls();

COMMIT;
