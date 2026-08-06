import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from roles.models import PortalUser, StudioCredential


class Command(BaseCommand):
    help = (
        "Idempotently creates/updates the one main Django admin superuser from "
        "DJANGO_SUPERUSER_EMAIL/DJANGO_SUPERUSER_PASSWORD, marks them as a portal "
        "admin, and seeds the Studio credential from DASHBOARD_USERNAME/DASHBOARD_PASSWORD "
        "on first run. Safe to run on every container start."
    )

    def handle(self, *args, **options):
        User = get_user_model()
        email = os.environ.get("DJANGO_SUPERUSER_EMAIL", "").strip().lower()
        password = os.environ.get("DJANGO_SUPERUSER_PASSWORD", "")

        if email and password:
            user, created = User.objects.get_or_create(
                username=email, defaults={"email": email, "is_staff": True, "is_superuser": True}
            )
            if created or not user.check_password(password):
                user.set_password(password)
                user.is_staff = True
                user.is_superuser = True
                user.email = email
                user.save()
                self.stdout.write(f"Superuser {email} {'created' if created else 'updated'}")

            portal_user, _ = PortalUser.objects.get_or_create(email=email)
            if not portal_user.is_admin:
                portal_user.is_admin = True
                portal_user.save()
                self.stdout.write(f"Marked {email} as a portal admin")
        else:
            self.stdout.write(
                self.style.WARNING("DJANGO_SUPERUSER_EMAIL/DJANGO_SUPERUSER_PASSWORD not set - skipping bootstrap")
            )

        cred = StudioCredential.load()
        seed_username = os.environ.get("DASHBOARD_USERNAME", "")
        seed_password = os.environ.get("DASHBOARD_PASSWORD", "")
        if not cred.password and seed_username and seed_password:
            cred.username = seed_username
            cred.password = seed_password
            cred.save()
            self.stdout.write("Seeded Studio credential from DASHBOARD_USERNAME/DASHBOARD_PASSWORD")
