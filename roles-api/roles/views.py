from rest_framework.generics import ListAPIView, RetrieveAPIView, RetrieveUpdateAPIView

from .models import PortalUser, StudioCredential
from .serializers import PortalUserSerializer, StudioCredentialSerializer


class PortalUserListView(ListAPIView):
    queryset = PortalUser.objects.all()
    serializer_class = PortalUserSerializer


class PortalUserDetailView(RetrieveUpdateAPIView):
    serializer_class = PortalUserSerializer

    def get_object(self) -> PortalUser:
        email = self.kwargs["email"].strip().lower()
        obj, _ = PortalUser.objects.get_or_create(email=email)
        return obj


class StudioCredentialView(RetrieveAPIView):
    serializer_class = StudioCredentialSerializer

    def get_object(self) -> StudioCredential:
        return StudioCredential.load()
