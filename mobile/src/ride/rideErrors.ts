import type { ApiError } from '../api/client';

/** Why the server refused to start or join a ride (403), in the rider's words. */
export function rideRefusalMessage(error: ApiError): string {
  const reason = error.body && typeof error.body === 'object' ? (error.body as { error?: unknown }).error : undefined;
  if (reason === 'email_verification_required') return 'Verify your email first: open the link we sent you (Settings → Account and login → Email).';
  if (reason === 'terms_acceptance_required') return 'Accept the latest Terms in Settings before riding with others.';
  return "You can't join this ride.";
}
