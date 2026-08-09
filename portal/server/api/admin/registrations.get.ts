export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const pending = await listPendingRegistrations();
  return pending.map((r) => ({
    id: r.id,
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    totpEnrolled: r.totp_enrolled,
    requestedAt: r.requested_at,
  }));
});
