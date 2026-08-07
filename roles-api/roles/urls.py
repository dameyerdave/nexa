from django.urls import path

from .views import (
    PortalUserDetailView,
    PortalUserListView,
    ProjectListCreateView,
    ProjectRetryMetabaseView,
    StudioCredentialView,
)

urlpatterns = [
    path("portal-users/", PortalUserListView.as_view()),
    path("portal-users/<str:email>/", PortalUserDetailView.as_view()),
    path("studio-credential/", StudioCredentialView.as_view()),
    path("projects/", ProjectListCreateView.as_view()),
    path("projects/<int:pk>/retry-metabase/", ProjectRetryMetabaseView.as_view()),
]
