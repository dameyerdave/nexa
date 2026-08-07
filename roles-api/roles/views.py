from rest_framework import status
from rest_framework.generics import GenericAPIView, ListAPIView, ListCreateAPIView, RetrieveAPIView, RetrieveUpdateAPIView
from rest_framework.response import Response

from .models import PortalUser, Project, StudioCredential
from .provisioning import ProvisioningError, create_project, retry_metabase
from .serializers import PortalUserSerializer, ProjectSerializer, StudioCredentialSerializer


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


class ProjectListCreateView(ListCreateAPIView):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer

    def create(self, request, *args, **kwargs):
        name = (request.data.get("name") or "").strip()
        created_by = (request.data.get("created_by") or "").strip().lower()
        if not name:
            return Response({"detail": "name is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            project, metabase_error = create_project(name, created_by)
        except ProvisioningError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        data = self.get_serializer(project).data
        data["metabase_error"] = metabase_error
        return Response(data, status=status.HTTP_201_CREATED)


class ProjectRetryMetabaseView(GenericAPIView):
    """POST /api/projects/<id>/retry-metabase/ - re-attempts just the
    Metabase half for a project whose schema exists but has no Metabase
    database yet (metabase_database_id is null), e.g. after Metabase was
    briefly unreachable during creation."""

    queryset = Project.objects.all()
    serializer_class = ProjectSerializer

    def post(self, request, *args, **kwargs):
        project = self.get_object()
        metabase_error = retry_metabase(project)
        data = self.get_serializer(project).data
        data["metabase_error"] = metabase_error
        return Response(data, status=status.HTTP_200_OK)
