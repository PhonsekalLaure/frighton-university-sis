BEGIN;

-- Photos use persistent URLs. Only the server service role uploads objects;
-- no browser INSERT/UPDATE/DELETE policies are added for this bucket.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('sis-student-photos','sis-student-photos',true,2097152,
  ARRAY['image/jpeg','image/png','image/webp']);

COMMIT;
