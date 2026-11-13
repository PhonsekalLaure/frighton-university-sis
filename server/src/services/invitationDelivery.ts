export type InvitationStatus = 'queued' | 'sending' | 'accepted' | 'failed' | 'unknown';
export interface InvitationDelivery { status: InvitationStatus; canRetry: boolean; updatedAt?: string; }
