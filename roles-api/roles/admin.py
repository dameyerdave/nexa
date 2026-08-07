from django.contrib import admin

from .models import PortalUser, Project, StudioCredential


@admin.register(PortalUser)
class PortalUserAdmin(admin.ModelAdmin):
    list_display = ("email", "is_admin", "dbadmin", "dashboardadmin", "updated_at")
    list_filter = ("is_admin", "dbadmin", "dashboardadmin")
    search_fields = ("email",)


@admin.register(StudioCredential)
class StudioCredentialAdmin(admin.ModelAdmin):
    list_display = ("username", "updated_at")

    def has_add_permission(self, request):
        return not StudioCredential.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "schema_name", "metabase_database_id", "created_by", "created_at")
    search_fields = ("name", "schema_name", "created_by")
