import type { InvitationDelivery } from '../types/admin';

export function invitationFeedback(delivery: InvitationDelivery): string {
  switch (delivery.status) {
    case 'accepted': return 'Invitation submitted to the email provider. Inbox delivery is not guaranteed.';
    case 'queued': return 'Invitation is pending. Use Send invitation to resume delivery.';
    case 'failed': return 'Invitation failed. The student account is saved; retry from this record.';
    case 'sending': return 'Invitation delivery is in progress. Further email requests are disabled.';
    case 'unknown': return 'Invitation delivery is unconfirmed. Operator review is required before another email.';
  }
}
