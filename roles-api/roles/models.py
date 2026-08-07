from django.db import models


class PortalUser(models.Model):
    """A Supabase Auth user's portal-managed roles. Identity (email) is
    still owned by Supabase Auth - this table only tracks what a signed-in
    user is allowed to do beyond the default. Rows are created lazily the
    first time a user is looked up."""

    email = models.EmailField(unique=True)
    is_admin = models.BooleanField(
        default=False,
        help_text="Can manage other users' roles (via the portal's /admin/users and the DRF API). "
        "Not editable through the API - grant it here only.",
    )
    dbadmin = models.BooleanField(
        default=False,
        help_text="Automatic (no extra login) access to the 'Data Model' tile / Supabase Studio.",
    )
    dashboardadmin = models.BooleanField(
        default=False,
        help_text="Edit access in Metabase. Everyone else gets read-only access.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["email"]

    def __str__(self):
        return self.email


class StudioCredential(models.Model):
    """Singleton: the shared HTTP Basic Auth credential Kong expects in
    front of Supabase Studio. Seeded once (by the bootstrap management
    command) from the deploy-time DASHBOARD_USERNAME/DASHBOARD_PASSWORD
    secret so it starts in sync with Kong's own consumer (see kong.yml) -
    manage it here going forward, not via environment variables. Note:
    rotating it here does not by itself change what Kong will accept - Kong
    runs DB-less from a declarative config baked at deploy time, so a
    rotation here also needs a matching redeploy to update Kong's secret."""

    username = models.CharField(max_length=150, default="supabase")
    password = models.CharField(max_length=150, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        pass

    @classmethod
    def load(cls) -> "StudioCredential":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "Studio credential"


class Project(models.Model):
    """A self-service Postgres schema + matching Metabase database
    connection, created from the portal's /admin/projects page by a
    dbadmin. See roles/provisioning.py for what creating one actually does
    to Postgres/Metabase - this row is just the record of it."""

    name = models.CharField(max_length=100)
    schema_name = models.CharField(max_length=63, unique=True)
    metabase_database_id = models.IntegerField(null=True, blank=True)
    created_by = models.EmailField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name
