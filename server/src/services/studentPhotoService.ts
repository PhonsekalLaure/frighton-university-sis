import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminPortalClient } from '../config/supabase.js';
import { AdminError } from './adminValidation.js';

export const studentPhotoLimit = 2 * 1024 * 1024;
export const studentPhotoBucket = 'sis-student-photos';

export function photoExtension(body: unknown, contentType: string): string {
  if (!Buffer.isBuffer(body) || !body.length) throw new AdminError(400, 'Choose a student photo.');
  if (body.length > studentPhotoLimit) throw new AdminError(413, 'Student photos must be 2 MB or smaller.');
  if (contentType === 'image/jpeg' && body.length > 3 && body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg';
  if (contentType === 'image/png' && body.length > 8 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (contentType === 'image/webp' && body.length > 12 && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new AdminError(400, 'Choose a JPEG, PNG, or WebP image.');
}

export class StudentPhotoService {
  constructor(private readonly injectedClient?: Pick<SupabaseClient, 'storage'>) {}

  async upload(actorId: string, body: unknown, contentType: string) {
    const extension = photoExtension(body, contentType);
    const bytes = body as Buffer;
    // Repeated uploads of the same file by this administrator reuse one object.
    const path = `${actorId}/${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
    const bucket = (this.injectedClient ?? getAdminPortalClient()).storage.from(studentPhotoBucket);
    try {
      const { error } = await bucket.upload(path, bytes, { contentType, upsert: false, cacheControl: '31536000' });
      if (error) {
        const details = error as { statusCode?: string | number; code?: string; message?: string };
        const status = String(details.statusCode);
        const duplicate = status === '409' || (status === '400' && (details.code === 'Duplicate' ||
          /^(?:the resource|asset|object) already exists\.?$/i.test(details.message ?? '')));
        if (!duplicate) throw error;
      }
      return { avatarUrl: bucket.getPublicUrl(path).data.publicUrl };
    } catch {
      throw new AdminError(503, 'Photo upload could not be completed. Please try again.');
    }
  }
}
