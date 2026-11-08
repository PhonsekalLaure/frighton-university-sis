import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

export const config = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
  lms: {
    apiKey: process.env.LMS_INTEGRATION_API_KEY || '',
    apiUrl: process.env.LMS_API_URL || 'http://localhost:5001',
    serviceKey: process.env.LMS_SERVICE_API_KEY || '',
    enabled: process.env.LIBRARY_SELF_SERVICE_ENABLED === 'true',
  },
};
