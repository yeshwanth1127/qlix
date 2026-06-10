import 'package:freezed_annotation/freezed_annotation.dart';

part 'session.freezed.dart';
part 'session.g.dart';

/// Mirrors the `user` object in the backend `AuthSuccessResponse`
/// (see `frontend/src/lib/auth-api.ts`).
@freezed
class SessionUser with _$SessionUser {
  const factory SessionUser({
    required String id,
    required String email,
    String? displayName,
    required String role,
    required String orgId,
    required String workspaceKind,
    @Default(false) bool isSuperAdmin,
    @Default(false) bool deviceVerified,
    @Default(false) bool billingExempt,
  }) = _SessionUser;

  factory SessionUser.fromJson(Map<String, dynamic> json) =>
      _$SessionUserFromJson(json);
}

/// Mirrors the `organization` object in the backend `AuthSuccessResponse`.
@freezed
class SessionOrganization with _$SessionOrganization {
  const factory SessionOrganization({
    required String id,
    required String name,
    required String slug,
    required String workspaceKind,
    required String plan,
  }) = _SessionOrganization;

  factory SessionOrganization.fromJson(Map<String, dynamic> json) =>
      _$SessionOrganizationFromJson(json);
}

/// The full authenticated session payload returned by login/signup/refresh/me.
///
/// `token` is the additive field the backend now returns in the JSON body
/// alongside the `Set-Cookie`; `/auth/me` does not include it so it is optional.
@freezed
class Session with _$Session {
  const factory Session({
    String? token,
    required SessionUser user,
    required SessionOrganization organization,
  }) = _Session;

  factory Session.fromJson(Map<String, dynamic> json) =>
      _$SessionFromJson(json);
}

extension SessionX on Session {
  bool get isOrganization => organization.workspaceKind == 'organization';
}
