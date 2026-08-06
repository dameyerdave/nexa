from django.urls import path

from .views import PortalUserDetailView, PortalUserListView, StudioCredentialView

urlpatterns = [
    path("portal-users/", PortalUserListView.as_view()),
    path("portal-users/<str:email>/", PortalUserDetailView.as_view()),
    path("studio-credential/", StudioCredentialView.as_view()),
]
