export async function refreshAuthoritativeSocialSnapshot(
  refreshNetwork: () => Promise<void>,
  refreshMessages: () => Promise<void>,
): Promise<void> {
  await Promise.all([refreshNetwork(), refreshMessages()]);
}
