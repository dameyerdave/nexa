from django.conf import settings
from rest_framework.permissions import BasePermission


class HasServiceToken(BasePermission):
    """Gates the whole DRF API behind a single shared bearer token known
    only to this service and the portal (ROLES_API_TOKEN) - there is no
    per-end-user auth here, the portal has already verified the caller's
    Supabase session before it ever calls this API."""

    def has_permission(self, request, view) -> bool:
        if not settings.ROLES_API_TOKEN:
            return False
        return request.headers.get("Authorization") == f"Bearer {settings.ROLES_API_TOKEN}"
