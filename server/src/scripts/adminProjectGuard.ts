import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.js';
import { assertSISLMSProject } from './projectGuard.js';

export const SIS_PROJECT_REF = 'pbkvjzclnwpucrhufyvr';
export function assertLinkedAdminProject(): void {
  assertSISLMSProject();
  if (new URL(config.supabase.url).hostname !== `${SIS_PROJECT_REF}.supabase.co` ||
    readFileSync(fileURLToPath(new URL('../../../supabase/.temp/project-ref', import.meta.url)), 'utf8').trim() !== SIS_PROJECT_REF) {
    throw new Error('Refusing to access a project other than the linked SIS project.');
  }
}
