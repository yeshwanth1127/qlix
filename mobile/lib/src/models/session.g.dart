// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'session.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$SessionUserImpl _$$SessionUserImplFromJson(Map<String, dynamic> json) =>
    _$SessionUserImpl(
      id: json['id'] as String,
      email: json['email'] as String,
      displayName: json['displayName'] as String?,
      role: json['role'] as String,
      orgId: json['orgId'] as String,
      workspaceKind: json['workspaceKind'] as String,
      isSuperAdmin: json['isSuperAdmin'] as bool? ?? false,
      deviceVerified: json['deviceVerified'] as bool? ?? false,
      billingExempt: json['billingExempt'] as bool? ?? false,
    );

Map<String, dynamic> _$$SessionUserImplToJson(_$SessionUserImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'email': instance.email,
      'displayName': instance.displayName,
      'role': instance.role,
      'orgId': instance.orgId,
      'workspaceKind': instance.workspaceKind,
      'isSuperAdmin': instance.isSuperAdmin,
      'deviceVerified': instance.deviceVerified,
      'billingExempt': instance.billingExempt,
    };

_$SessionOrganizationImpl _$$SessionOrganizationImplFromJson(
  Map<String, dynamic> json,
) => _$SessionOrganizationImpl(
  id: json['id'] as String,
  name: json['name'] as String,
  slug: json['slug'] as String,
  workspaceKind: json['workspaceKind'] as String,
  plan: json['plan'] as String,
);

Map<String, dynamic> _$$SessionOrganizationImplToJson(
  _$SessionOrganizationImpl instance,
) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'slug': instance.slug,
  'workspaceKind': instance.workspaceKind,
  'plan': instance.plan,
};

_$SessionImpl _$$SessionImplFromJson(Map<String, dynamic> json) =>
    _$SessionImpl(
      token: json['token'] as String?,
      user: SessionUser.fromJson(json['user'] as Map<String, dynamic>),
      organization: SessionOrganization.fromJson(
        json['organization'] as Map<String, dynamic>,
      ),
    );

Map<String, dynamic> _$$SessionImplToJson(_$SessionImpl instance) =>
    <String, dynamic>{
      'token': instance.token,
      'user': instance.user,
      'organization': instance.organization,
    };
