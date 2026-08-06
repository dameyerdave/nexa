from rest_framework import serializers

from .models import PortalUser, StudioCredential


class PortalUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = PortalUser
        fields = ["email", "is_admin", "dbadmin", "dashboardadmin"]
        read_only_fields = ["email", "is_admin"]


class StudioCredentialSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudioCredential
        fields = ["username", "password"]
