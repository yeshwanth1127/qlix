// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'session.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

SessionUser _$SessionUserFromJson(Map<String, dynamic> json) {
  return _SessionUser.fromJson(json);
}

/// @nodoc
mixin _$SessionUser {
  String get id => throw _privateConstructorUsedError;
  String get email => throw _privateConstructorUsedError;
  String? get displayName => throw _privateConstructorUsedError;
  String get role => throw _privateConstructorUsedError;
  String get orgId => throw _privateConstructorUsedError;
  String get workspaceKind => throw _privateConstructorUsedError;
  bool get isSuperAdmin => throw _privateConstructorUsedError;
  bool get deviceVerified => throw _privateConstructorUsedError;
  bool get billingExempt => throw _privateConstructorUsedError;

  /// Serializes this SessionUser to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of SessionUser
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $SessionUserCopyWith<SessionUser> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $SessionUserCopyWith<$Res> {
  factory $SessionUserCopyWith(
    SessionUser value,
    $Res Function(SessionUser) then,
  ) = _$SessionUserCopyWithImpl<$Res, SessionUser>;
  @useResult
  $Res call({
    String id,
    String email,
    String? displayName,
    String role,
    String orgId,
    String workspaceKind,
    bool isSuperAdmin,
    bool deviceVerified,
    bool billingExempt,
  });
}

/// @nodoc
class _$SessionUserCopyWithImpl<$Res, $Val extends SessionUser>
    implements $SessionUserCopyWith<$Res> {
  _$SessionUserCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of SessionUser
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? email = null,
    Object? displayName = freezed,
    Object? role = null,
    Object? orgId = null,
    Object? workspaceKind = null,
    Object? isSuperAdmin = null,
    Object? deviceVerified = null,
    Object? billingExempt = null,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            email: null == email
                ? _value.email
                : email // ignore: cast_nullable_to_non_nullable
                      as String,
            displayName: freezed == displayName
                ? _value.displayName
                : displayName // ignore: cast_nullable_to_non_nullable
                      as String?,
            role: null == role
                ? _value.role
                : role // ignore: cast_nullable_to_non_nullable
                      as String,
            orgId: null == orgId
                ? _value.orgId
                : orgId // ignore: cast_nullable_to_non_nullable
                      as String,
            workspaceKind: null == workspaceKind
                ? _value.workspaceKind
                : workspaceKind // ignore: cast_nullable_to_non_nullable
                      as String,
            isSuperAdmin: null == isSuperAdmin
                ? _value.isSuperAdmin
                : isSuperAdmin // ignore: cast_nullable_to_non_nullable
                      as bool,
            deviceVerified: null == deviceVerified
                ? _value.deviceVerified
                : deviceVerified // ignore: cast_nullable_to_non_nullable
                      as bool,
            billingExempt: null == billingExempt
                ? _value.billingExempt
                : billingExempt // ignore: cast_nullable_to_non_nullable
                      as bool,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$SessionUserImplCopyWith<$Res>
    implements $SessionUserCopyWith<$Res> {
  factory _$$SessionUserImplCopyWith(
    _$SessionUserImpl value,
    $Res Function(_$SessionUserImpl) then,
  ) = __$$SessionUserImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    String email,
    String? displayName,
    String role,
    String orgId,
    String workspaceKind,
    bool isSuperAdmin,
    bool deviceVerified,
    bool billingExempt,
  });
}

/// @nodoc
class __$$SessionUserImplCopyWithImpl<$Res>
    extends _$SessionUserCopyWithImpl<$Res, _$SessionUserImpl>
    implements _$$SessionUserImplCopyWith<$Res> {
  __$$SessionUserImplCopyWithImpl(
    _$SessionUserImpl _value,
    $Res Function(_$SessionUserImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of SessionUser
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? email = null,
    Object? displayName = freezed,
    Object? role = null,
    Object? orgId = null,
    Object? workspaceKind = null,
    Object? isSuperAdmin = null,
    Object? deviceVerified = null,
    Object? billingExempt = null,
  }) {
    return _then(
      _$SessionUserImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        email: null == email
            ? _value.email
            : email // ignore: cast_nullable_to_non_nullable
                  as String,
        displayName: freezed == displayName
            ? _value.displayName
            : displayName // ignore: cast_nullable_to_non_nullable
                  as String?,
        role: null == role
            ? _value.role
            : role // ignore: cast_nullable_to_non_nullable
                  as String,
        orgId: null == orgId
            ? _value.orgId
            : orgId // ignore: cast_nullable_to_non_nullable
                  as String,
        workspaceKind: null == workspaceKind
            ? _value.workspaceKind
            : workspaceKind // ignore: cast_nullable_to_non_nullable
                  as String,
        isSuperAdmin: null == isSuperAdmin
            ? _value.isSuperAdmin
            : isSuperAdmin // ignore: cast_nullable_to_non_nullable
                  as bool,
        deviceVerified: null == deviceVerified
            ? _value.deviceVerified
            : deviceVerified // ignore: cast_nullable_to_non_nullable
                  as bool,
        billingExempt: null == billingExempt
            ? _value.billingExempt
            : billingExempt // ignore: cast_nullable_to_non_nullable
                  as bool,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$SessionUserImpl implements _SessionUser {
  const _$SessionUserImpl({
    required this.id,
    required this.email,
    this.displayName,
    required this.role,
    required this.orgId,
    required this.workspaceKind,
    this.isSuperAdmin = false,
    this.deviceVerified = false,
    this.billingExempt = false,
  });

  factory _$SessionUserImpl.fromJson(Map<String, dynamic> json) =>
      _$$SessionUserImplFromJson(json);

  @override
  final String id;
  @override
  final String email;
  @override
  final String? displayName;
  @override
  final String role;
  @override
  final String orgId;
  @override
  final String workspaceKind;
  @override
  @JsonKey()
  final bool isSuperAdmin;
  @override
  @JsonKey()
  final bool deviceVerified;
  @override
  @JsonKey()
  final bool billingExempt;

  @override
  String toString() {
    return 'SessionUser(id: $id, email: $email, displayName: $displayName, role: $role, orgId: $orgId, workspaceKind: $workspaceKind, isSuperAdmin: $isSuperAdmin, deviceVerified: $deviceVerified, billingExempt: $billingExempt)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$SessionUserImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.email, email) || other.email == email) &&
            (identical(other.displayName, displayName) ||
                other.displayName == displayName) &&
            (identical(other.role, role) || other.role == role) &&
            (identical(other.orgId, orgId) || other.orgId == orgId) &&
            (identical(other.workspaceKind, workspaceKind) ||
                other.workspaceKind == workspaceKind) &&
            (identical(other.isSuperAdmin, isSuperAdmin) ||
                other.isSuperAdmin == isSuperAdmin) &&
            (identical(other.deviceVerified, deviceVerified) ||
                other.deviceVerified == deviceVerified) &&
            (identical(other.billingExempt, billingExempt) ||
                other.billingExempt == billingExempt));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    email,
    displayName,
    role,
    orgId,
    workspaceKind,
    isSuperAdmin,
    deviceVerified,
    billingExempt,
  );

  /// Create a copy of SessionUser
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$SessionUserImplCopyWith<_$SessionUserImpl> get copyWith =>
      __$$SessionUserImplCopyWithImpl<_$SessionUserImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$SessionUserImplToJson(this);
  }
}

abstract class _SessionUser implements SessionUser {
  const factory _SessionUser({
    required final String id,
    required final String email,
    final String? displayName,
    required final String role,
    required final String orgId,
    required final String workspaceKind,
    final bool isSuperAdmin,
    final bool deviceVerified,
    final bool billingExempt,
  }) = _$SessionUserImpl;

  factory _SessionUser.fromJson(Map<String, dynamic> json) =
      _$SessionUserImpl.fromJson;

  @override
  String get id;
  @override
  String get email;
  @override
  String? get displayName;
  @override
  String get role;
  @override
  String get orgId;
  @override
  String get workspaceKind;
  @override
  bool get isSuperAdmin;
  @override
  bool get deviceVerified;
  @override
  bool get billingExempt;

  /// Create a copy of SessionUser
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$SessionUserImplCopyWith<_$SessionUserImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

SessionOrganization _$SessionOrganizationFromJson(Map<String, dynamic> json) {
  return _SessionOrganization.fromJson(json);
}

/// @nodoc
mixin _$SessionOrganization {
  String get id => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  String get slug => throw _privateConstructorUsedError;
  String get workspaceKind => throw _privateConstructorUsedError;
  String get plan => throw _privateConstructorUsedError;

  /// Serializes this SessionOrganization to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of SessionOrganization
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $SessionOrganizationCopyWith<SessionOrganization> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $SessionOrganizationCopyWith<$Res> {
  factory $SessionOrganizationCopyWith(
    SessionOrganization value,
    $Res Function(SessionOrganization) then,
  ) = _$SessionOrganizationCopyWithImpl<$Res, SessionOrganization>;
  @useResult
  $Res call({
    String id,
    String name,
    String slug,
    String workspaceKind,
    String plan,
  });
}

/// @nodoc
class _$SessionOrganizationCopyWithImpl<$Res, $Val extends SessionOrganization>
    implements $SessionOrganizationCopyWith<$Res> {
  _$SessionOrganizationCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of SessionOrganization
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? slug = null,
    Object? workspaceKind = null,
    Object? plan = null,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            name: null == name
                ? _value.name
                : name // ignore: cast_nullable_to_non_nullable
                      as String,
            slug: null == slug
                ? _value.slug
                : slug // ignore: cast_nullable_to_non_nullable
                      as String,
            workspaceKind: null == workspaceKind
                ? _value.workspaceKind
                : workspaceKind // ignore: cast_nullable_to_non_nullable
                      as String,
            plan: null == plan
                ? _value.plan
                : plan // ignore: cast_nullable_to_non_nullable
                      as String,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$SessionOrganizationImplCopyWith<$Res>
    implements $SessionOrganizationCopyWith<$Res> {
  factory _$$SessionOrganizationImplCopyWith(
    _$SessionOrganizationImpl value,
    $Res Function(_$SessionOrganizationImpl) then,
  ) = __$$SessionOrganizationImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    String name,
    String slug,
    String workspaceKind,
    String plan,
  });
}

/// @nodoc
class __$$SessionOrganizationImplCopyWithImpl<$Res>
    extends _$SessionOrganizationCopyWithImpl<$Res, _$SessionOrganizationImpl>
    implements _$$SessionOrganizationImplCopyWith<$Res> {
  __$$SessionOrganizationImplCopyWithImpl(
    _$SessionOrganizationImpl _value,
    $Res Function(_$SessionOrganizationImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of SessionOrganization
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? slug = null,
    Object? workspaceKind = null,
    Object? plan = null,
  }) {
    return _then(
      _$SessionOrganizationImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        name: null == name
            ? _value.name
            : name // ignore: cast_nullable_to_non_nullable
                  as String,
        slug: null == slug
            ? _value.slug
            : slug // ignore: cast_nullable_to_non_nullable
                  as String,
        workspaceKind: null == workspaceKind
            ? _value.workspaceKind
            : workspaceKind // ignore: cast_nullable_to_non_nullable
                  as String,
        plan: null == plan
            ? _value.plan
            : plan // ignore: cast_nullable_to_non_nullable
                  as String,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$SessionOrganizationImpl implements _SessionOrganization {
  const _$SessionOrganizationImpl({
    required this.id,
    required this.name,
    required this.slug,
    required this.workspaceKind,
    required this.plan,
  });

  factory _$SessionOrganizationImpl.fromJson(Map<String, dynamic> json) =>
      _$$SessionOrganizationImplFromJson(json);

  @override
  final String id;
  @override
  final String name;
  @override
  final String slug;
  @override
  final String workspaceKind;
  @override
  final String plan;

  @override
  String toString() {
    return 'SessionOrganization(id: $id, name: $name, slug: $slug, workspaceKind: $workspaceKind, plan: $plan)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$SessionOrganizationImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.slug, slug) || other.slug == slug) &&
            (identical(other.workspaceKind, workspaceKind) ||
                other.workspaceKind == workspaceKind) &&
            (identical(other.plan, plan) || other.plan == plan));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode =>
      Object.hash(runtimeType, id, name, slug, workspaceKind, plan);

  /// Create a copy of SessionOrganization
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$SessionOrganizationImplCopyWith<_$SessionOrganizationImpl> get copyWith =>
      __$$SessionOrganizationImplCopyWithImpl<_$SessionOrganizationImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$SessionOrganizationImplToJson(this);
  }
}

abstract class _SessionOrganization implements SessionOrganization {
  const factory _SessionOrganization({
    required final String id,
    required final String name,
    required final String slug,
    required final String workspaceKind,
    required final String plan,
  }) = _$SessionOrganizationImpl;

  factory _SessionOrganization.fromJson(Map<String, dynamic> json) =
      _$SessionOrganizationImpl.fromJson;

  @override
  String get id;
  @override
  String get name;
  @override
  String get slug;
  @override
  String get workspaceKind;
  @override
  String get plan;

  /// Create a copy of SessionOrganization
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$SessionOrganizationImplCopyWith<_$SessionOrganizationImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

Session _$SessionFromJson(Map<String, dynamic> json) {
  return _Session.fromJson(json);
}

/// @nodoc
mixin _$Session {
  String? get token => throw _privateConstructorUsedError;
  SessionUser get user => throw _privateConstructorUsedError;
  SessionOrganization get organization => throw _privateConstructorUsedError;

  /// Serializes this Session to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of Session
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $SessionCopyWith<Session> get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $SessionCopyWith<$Res> {
  factory $SessionCopyWith(Session value, $Res Function(Session) then) =
      _$SessionCopyWithImpl<$Res, Session>;
  @useResult
  $Res call({
    String? token,
    SessionUser user,
    SessionOrganization organization,
  });

  $SessionUserCopyWith<$Res> get user;
  $SessionOrganizationCopyWith<$Res> get organization;
}

/// @nodoc
class _$SessionCopyWithImpl<$Res, $Val extends Session>
    implements $SessionCopyWith<$Res> {
  _$SessionCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of Session
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? token = freezed,
    Object? user = null,
    Object? organization = null,
  }) {
    return _then(
      _value.copyWith(
            token: freezed == token
                ? _value.token
                : token // ignore: cast_nullable_to_non_nullable
                      as String?,
            user: null == user
                ? _value.user
                : user // ignore: cast_nullable_to_non_nullable
                      as SessionUser,
            organization: null == organization
                ? _value.organization
                : organization // ignore: cast_nullable_to_non_nullable
                      as SessionOrganization,
          )
          as $Val,
    );
  }

  /// Create a copy of Session
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $SessionUserCopyWith<$Res> get user {
    return $SessionUserCopyWith<$Res>(_value.user, (value) {
      return _then(_value.copyWith(user: value) as $Val);
    });
  }

  /// Create a copy of Session
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $SessionOrganizationCopyWith<$Res> get organization {
    return $SessionOrganizationCopyWith<$Res>(_value.organization, (value) {
      return _then(_value.copyWith(organization: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$SessionImplCopyWith<$Res> implements $SessionCopyWith<$Res> {
  factory _$$SessionImplCopyWith(
    _$SessionImpl value,
    $Res Function(_$SessionImpl) then,
  ) = __$$SessionImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String? token,
    SessionUser user,
    SessionOrganization organization,
  });

  @override
  $SessionUserCopyWith<$Res> get user;
  @override
  $SessionOrganizationCopyWith<$Res> get organization;
}

/// @nodoc
class __$$SessionImplCopyWithImpl<$Res>
    extends _$SessionCopyWithImpl<$Res, _$SessionImpl>
    implements _$$SessionImplCopyWith<$Res> {
  __$$SessionImplCopyWithImpl(
    _$SessionImpl _value,
    $Res Function(_$SessionImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of Session
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? token = freezed,
    Object? user = null,
    Object? organization = null,
  }) {
    return _then(
      _$SessionImpl(
        token: freezed == token
            ? _value.token
            : token // ignore: cast_nullable_to_non_nullable
                  as String?,
        user: null == user
            ? _value.user
            : user // ignore: cast_nullable_to_non_nullable
                  as SessionUser,
        organization: null == organization
            ? _value.organization
            : organization // ignore: cast_nullable_to_non_nullable
                  as SessionOrganization,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$SessionImpl implements _Session {
  const _$SessionImpl({
    this.token,
    required this.user,
    required this.organization,
  });

  factory _$SessionImpl.fromJson(Map<String, dynamic> json) =>
      _$$SessionImplFromJson(json);

  @override
  final String? token;
  @override
  final SessionUser user;
  @override
  final SessionOrganization organization;

  @override
  String toString() {
    return 'Session(token: $token, user: $user, organization: $organization)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$SessionImpl &&
            (identical(other.token, token) || other.token == token) &&
            (identical(other.user, user) || other.user == user) &&
            (identical(other.organization, organization) ||
                other.organization == organization));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, token, user, organization);

  /// Create a copy of Session
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$SessionImplCopyWith<_$SessionImpl> get copyWith =>
      __$$SessionImplCopyWithImpl<_$SessionImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$SessionImplToJson(this);
  }
}

abstract class _Session implements Session {
  const factory _Session({
    final String? token,
    required final SessionUser user,
    required final SessionOrganization organization,
  }) = _$SessionImpl;

  factory _Session.fromJson(Map<String, dynamic> json) = _$SessionImpl.fromJson;

  @override
  String? get token;
  @override
  SessionUser get user;
  @override
  SessionOrganization get organization;

  /// Create a copy of Session
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$SessionImplCopyWith<_$SessionImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
