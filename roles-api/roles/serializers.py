from rest_framework import serializers

from .models import PortalUser, Project, StudioCredential


class PortalUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = PortalUser
        fields = ["email", "is_admin", "dbadmin", "dashboardadmin"]
        read_only_fields = ["email", "is_admin"]


class StudioCredentialSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudioCredential
        fields = ["username", "password"]


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ["id", "name", "schema_name", "metabase_database_id", "created_by", "created_at"]
        read_only_fields = ["id", "name", "schema_name", "created_by", "created_at"]
