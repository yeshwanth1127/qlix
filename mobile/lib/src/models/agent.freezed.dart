// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'agent.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

AgentDTO _$AgentDTOFromJson(Map<String, dynamic> json) {
  return _AgentDTO.fromJson(json);
}

/// @nodoc
mixin _$AgentDTO {
  String get id => throw _privateConstructorUsedError;
  String get userId => throw _privateConstructorUsedError;
  String? get orgId => throw _privateConstructorUsedError;
  String get did => throw _privateConstructorUsedError;
  String get publicKey => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  String? get description => throw _privateConstructorUsedError;
  String get status => throw _privateConstructorUsedError;
  String get runtime => throw _privateConstructorUsedError;
  String get model => throw _privateConstructorUsedError;
  String? get localInferenceMode => throw _privateConstructorUsedError;
  String get llmMode => throw _privateConstructorUsedError;
  List<String> get permissionScopes => throw _privateConstructorUsedError;
  List<String> get jitScopes => throw _privateConstructorUsedError;
  List<String> get alwaysScopes => throw _privateConstructorUsedError;
  String? get webauthnCredentialId => throw _privateConstructorUsedError;
  String? get keypairDeliveredAt => throw _privateConstructorUsedError;
  String? get lastConnectedAt => throw _privateConstructorUsedError;
  String? get lastActive => throw _privateConstructorUsedError;
  String? get createdAt => throw _privateConstructorUsedError;
  String? get cloudProvisioningStatus => throw _privateConstructorUsedError;
  String? get cloudRunnerId => throw _privateConstructorUsedError;
  String? get cloudLastHeartbeatAt => throw _privateConstructorUsedError;
  String? get cloudProvisioningError => throw _privateConstructorUsedError;
  String? get hybridLastHeartbeatAt => throw _privateConstructorUsedError;
  String? get agentKind => throw _privateConstructorUsedError;

  /// Serializes this AgentDTO to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of AgentDTO
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $AgentDTOCopyWith<AgentDTO> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $AgentDTOCopyWith<$Res> {
  factory $AgentDTOCopyWith(AgentDTO value, $Res Function(AgentDTO) then) =
      _$AgentDTOCopyWithImpl<$Res, AgentDTO>;
  @useResult
  $Res call({
    String id,
    String userId,
    String? orgId,
    String did,
    String publicKey,
    String name,
    String? description,
    String status,
    String runtime,
    String model,
    String? localInferenceMode,
    String llmMode,
    List<String> permissionScopes,
    List<String> jitScopes,
    List<String> alwaysScopes,
    String? webauthnCredentialId,
    String? keypairDeliveredAt,
    String? lastConnectedAt,
    String? lastActive,
    String? createdAt,
    String? cloudProvisioningStatus,
    String? cloudRunnerId,
    String? cloudLastHeartbeatAt,
    String? cloudProvisioningError,
    String? hybridLastHeartbeatAt,
    String? agentKind,
  });
}

/// @nodoc
class _$AgentDTOCopyWithImpl<$Res, $Val extends AgentDTO>
    implements $AgentDTOCopyWith<$Res> {
  _$AgentDTOCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of AgentDTO
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? userId = null,
    Object? orgId = freezed,
    Object? did = null,
    Object? publicKey = null,
    Object? name = null,
    Object? description = freezed,
    Object? status = null,
    Object? runtime = null,
    Object? model = null,
    Object? localInferenceMode = freezed,
    Object? llmMode = null,
    Object? permissionScopes = null,
    Object? jitScopes = null,
    Object? alwaysScopes = null,
    Object? webauthnCredentialId = freezed,
    Object? keypairDeliveredAt = freezed,
    Object? lastConnectedAt = freezed,
    Object? lastActive = freezed,
    Object? createdAt = freezed,
    Object? cloudProvisioningStatus = freezed,
    Object? cloudRunnerId = freezed,
    Object? cloudLastHeartbeatAt = freezed,
    Object? cloudProvisioningError = freezed,
    Object? hybridLastHeartbeatAt = freezed,
    Object? agentKind = freezed,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            userId: null == userId
                ? _value.userId
                : userId // ignore: cast_nullable_to_non_nullable
                      as String,
            orgId: freezed == orgId
                ? _value.orgId
                : orgId // ignore: cast_nullable_to_non_nullable
                      as String?,
            did: null == did
                ? _value.did
                : did // ignore: cast_nullable_to_non_nullable
                      as String,
            publicKey: null == publicKey
                ? _value.publicKey
                : publicKey // ignore: cast_nullable_to_non_nullable
                      as String,
            name: null == name
                ? _value.name
                : name // ignore: cast_nullable_to_non_nullable
                      as String,
            description: freezed == description
                ? _value.description
                : description // ignore: cast_nullable_to_non_nullable
                      as String?,
            status: null == status
                ? _value.status
                : status // ignore: cast_nullable_to_non_nullable
                      as String,
            runtime: null == runtime
                ? _value.runtime
                : runtime // ignore: cast_nullable_to_non_nullable
                      as String,
            model: null == model
                ? _value.model
                : model // ignore: cast_nullable_to_non_nullable
                      as String,
            localInferenceMode: freezed == localInferenceMode
                ? _value.localInferenceMode
                : localInferenceMode // ignore: cast_nullable_to_non_nullable
                      as String?,
            llmMode: null == llmMode
                ? _value.llmMode
                : llmMode // ignore: cast_nullable_to_non_nullable
                      as String,
            permissionScopes: null == permissionScopes
                ? _value.permissionScopes
                : permissionScopes // ignore: cast_nullable_to_non_nullable
                      as List<String>,
            jitScopes: null == jitScopes
                ? _value.jitScopes
                : jitScopes // ignore: cast_nullable_to_non_nullable
                      as List<String>,
            alwaysScopes: null == alwaysScopes
                ? _value.alwaysScopes
                : alwaysScopes // ignore: cast_nullable_to_non_nullable
                      as List<String>,
            webauthnCredentialId: freezed == webauthnCredentialId
                ? _value.webauthnCredentialId
                : webauthnCredentialId // ignore: cast_nullable_to_non_nullable
                      as String?,
            keypairDeliveredAt: freezed == keypairDeliveredAt
                ? _value.keypairDeliveredAt
                : keypairDeliveredAt // ignore: cast_nullable_to_non_nullable
                      as String?,
            lastConnectedAt: freezed == lastConnectedAt
                ? _value.lastConnectedAt
                : lastConnectedAt // ignore: cast_nullable_to_non_nullable
                      as String?,
            lastActive: freezed == lastActive
                ? _value.lastActive
                : lastActive // ignore: cast_nullable_to_non_nullable
                      as String?,
            createdAt: freezed == createdAt
                ? _value.createdAt
                : createdAt // ignore: cast_nullable_to_non_nullable
                      as String?,
            cloudProvisioningStatus: freezed == cloudProvisioningStatus
                ? _value.cloudProvisioningStatus
                : cloudProvisioningStatus // ignore: cast_nullable_to_non_nullable
                      as String?,
            cloudRunnerId: freezed == cloudRunnerId
                ? _value.cloudRunnerId
                : cloudRunnerId // ignore: cast_nullable_to_non_nullable
                      as String?,
            cloudLastHeartbeatAt: freezed == cloudLastHeartbeatAt
                ? _value.cloudLastHeartbeatAt
                : cloudLastHeartbeatAt // ignore: cast_nullable_to_non_nullable
                      as String?,
            cloudProvisioningError: freezed == cloudProvisioningError
                ? _value.cloudProvisioningError
                : cloudProvisioningError // ignore: cast_nullable_to_non_nullable
                      as String?,
            hybridLastHeartbeatAt: freezed == hybridLastHeartbeatAt
                ? _value.hybridLastHeartbeatAt
                : hybridLastHeartbeatAt // ignore: cast_nullable_to_non_nullable
                      as String?,
            agentKind: freezed == agentKind
                ? _value.agentKind
                : agentKind // ignore: cast_nullable_to_non_nullable
                      as String?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$AgentDTOImplCopyWith<$Res>
    implements $AgentDTOCopyWith<$Res> {
  factory _$$AgentDTOImplCopyWith(
    _$AgentDTOImpl value,
    $Res Function(_$AgentDTOImpl) then,
  ) = __$$AgentDTOImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    String userId,
    String? orgId,
    String did,
    String publicKey,
    String name,
    String? description,
    String status,
    String runtime,
    String model,
    String? localInferenceMode,
    String llmMode,
    List<String> permissionScopes,
    List<String> jitScopes,
    List<String> alwaysScopes,
    String? webauthnCredentialId,
    String? keypairDeliveredAt,
    String? lastConnectedAt,
    String? lastActive,
    String? createdAt,
    String? cloudProvisioningStatus,
    String? cloudRunnerId,
    String? cloudLastHeartbeatAt,
    String? cloudProvisioningError,
    String? hybridLastHeartbeatAt,
    String? agentKind,
  });
}

/// @nodoc
class __$$AgentDTOImplCopyWithImpl<$Res>
    extends _$AgentDTOCopyWithImpl<$Res, _$AgentDTOImpl>
    implements _$$AgentDTOImplCopyWith<$Res> {
  __$$AgentDTOImplCopyWithImpl(
    _$AgentDTOImpl _value,
    $Res Function(_$AgentDTOImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of AgentDTO
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? userId = null,
    Object? orgId = freezed,
    Object? did = null,
    Object? publicKey = null,
    Object? name = null,
    Object? description = freezed,
    Object? status = null,
    Object? runtime = null,
    Object? model = null,
    Object? localInferenceMode = freezed,
    Object? llmMode = null,
    Object? permissionScopes = null,
    Object? jitScopes = null,
    Object? alwaysScopes = null,
    Object? webauthnCredentialId = freezed,
    Object? keypairDeliveredAt = freezed,
    Object? lastConnectedAt = freezed,
    Object? lastActive = freezed,
    Object? createdAt = freezed,
    Object? cloudProvisioningStatus = freezed,
    Object? cloudRunnerId = freezed,
    Object? cloudLastHeartbeatAt = freezed,
    Object? cloudProvisioningError = freezed,
    Object? hybridLastHeartbeatAt = freezed,
    Object? agentKind = freezed,
  }) {
    return _then(
      _$AgentDTOImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        userId: null == userId
            ? _value.userId
            : userId // ignore: cast_nullable_to_non_nullable
                  as String,
        orgId: freezed == orgId
            ? _value.orgId
            : orgId // ignore: cast_nullable_to_non_nullable
                  as String?,
        did: null == did
            ? _value.did
            : did // ignore: cast_nullable_to_non_nullable
                  as String,
        publicKey: null == publicKey
            ? _value.publicKey
            : publicKey // ignore: cast_nullable_to_non_nullable
                  as String,
        name: null == name
            ? _value.name
            : name // ignore: cast_nullable_to_non_nullable
                  as String,
        description: freezed == description
            ? _value.description
            : description // ignore: cast_nullable_to_non_nullable
                  as String?,
        status: null == status
            ? _value.status
            : status // ignore: cast_nullable_to_non_nullable
                  as String,
        runtime: null == runtime
            ? _value.runtime
            : runtime // ignore: cast_nullable_to_non_nullable
                  as String,
        model: null == model
            ? _value.model
            : model // ignore: cast_nullable_to_non_nullable
                  as String,
        localInferenceMode: freezed == localInferenceMode
            ? _value.localInferenceMode
            : localInferenceMode // ignore: cast_nullable_to_non_nullable
                  as String?,
        llmMode: null == llmMode
            ? _value.llmMode
            : llmMode // ignore: cast_nullable_to_non_nullable
                  as String,
        permissionScopes: null == permissionScopes
            ? _value._permissionScopes
            : permissionScopes // ignore: cast_nullable_to_non_nullable
                  as List<String>,
        jitScopes: null == jitScopes
            ? _value._jitScopes
            : jitScopes // ignore: cast_nullable_to_non_nullable
                  as List<String>,
        alwaysScopes: null == alwaysScopes
            ? _value._alwaysScopes
            : alwaysScopes // ignore: cast_nullable_to_non_nullable
                  as List<String>,
        webauthnCredentialId: freezed == webauthnCredentialId
            ? _value.webauthnCredentialId
            : webauthnCredentialId // ignore: cast_nullable_to_non_nullable
                  as String?,
        keypairDeliveredAt: freezed == keypairDeliveredAt
            ? _value.keypairDeliveredAt
            : keypairDeliveredAt // ignore: cast_nullable_to_non_nullable
                  as String?,
        lastConnectedAt: freezed == lastConnectedAt
            ? _value.lastConnectedAt
            : lastConnectedAt // ignore: cast_nullable_to_non_nullable
                  as String?,
        lastActive: freezed == lastActive
            ? _value.lastActive
            : lastActive // ignore: cast_nullable_to_non_nullable
                  as String?,
        createdAt: freezed == createdAt
            ? _value.createdAt
            : createdAt // ignore: cast_nullable_to_non_nullable
                  as String?,
        cloudProvisioningStatus: freezed == cloudProvisioningStatus
            ? _value.cloudProvisioningStatus
            : cloudProvisioningStatus // ignore: cast_nullable_to_non_nullable
                  as String?,
        cloudRunnerId: freezed == cloudRunnerId
            ? _value.cloudRunnerId
            : cloudRunnerId // ignore: cast_nullable_to_non_nullable
                  as String?,
        cloudLastHeartbeatAt: freezed == cloudLastHeartbeatAt
            ? _value.cloudLastHeartbeatAt
            : cloudLastHeartbeatAt // ignore: cast_nullable_to_non_nullable
                  as String?,
        cloudProvisioningError: freezed == cloudProvisioningError
            ? _value.cloudProvisioningError
            : cloudProvisioningError // ignore: cast_nullable_to_non_nullable
                  as String?,
        hybridLastHeartbeatAt: freezed == hybridLastHeartbeatAt
            ? _value.hybridLastHeartbeatAt
            : hybridLastHeartbeatAt // ignore: cast_nullable_to_non_nullable
                  as String?,
        agentKind: freezed == agentKind
            ? _value.agentKind
            : agentKind // ignore: cast_nullable_to_non_nullable
                  as String?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$AgentDTOImpl implements _AgentDTO {
  const _$AgentDTOImpl({
    required this.id,
    required this.userId,
    this.orgId,
    this.did = '',
    this.publicKey = '',
    required this.name,
    this.description,
    this.status = '',
    this.runtime = 'cloud',
    this.model = '',
    this.localInferenceMode,
    this.llmMode = 'direct',
    final List<String> permissionScopes = const <String>[],
    final List<String> jitScopes = const <String>[],
    final List<String> alwaysScopes = const <String>[],
    this.webauthnCredentialId,
    this.keypairDeliveredAt,
    this.lastConnectedAt,
    this.lastActive,
    this.createdAt,
    this.cloudProvisioningStatus,
    this.cloudRunnerId,
    this.cloudLastHeartbeatAt,
    this.cloudProvisioningError,
    this.hybridLastHeartbeatAt,
    this.agentKind,
  }) : _permissionScopes = permissionScopes,
       _jitScopes = jitScopes,
       _alwaysScopes = alwaysScopes;

  factory _$AgentDTOImpl.fromJson(Map<String, dynamic> json) =>
      _$$AgentDTOImplFromJson(json);

  @override
  final String id;
  @override
  final String userId;
  @override
  final String? orgId;
  @override
  @JsonKey()
  final String did;
  @override
  @JsonKey()
  final String publicKey;
  @override
  final String name;
  @override
  final String? description;
  @override
  @JsonKey()
  final String status;
  @override
  @JsonKey()
  final String runtime;
  @override
  @JsonKey()
  final String model;
  @override
  final String? localInferenceMode;
  @override
  @JsonKey()
  final String llmMode;
  final List<String> _permissionScopes;
  @override
  @JsonKey()
  List<String> get permissionScopes {
    if (_permissionScopes is EqualUnmodifiableListView)
      return _permissionScopes;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_permissionScopes);
  }

  final List<String> _jitScopes;
  @override
  @JsonKey()
  List<String> get jitScopes {
    if (_jitScopes is EqualUnmodifiableListView) return _jitScopes;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_jitScopes);
  }

  final List<String> _alwaysScopes;
  @override
  @JsonKey()
  List<String> get alwaysScopes {
    if (_alwaysScopes is EqualUnmodifiableListView) return _alwaysScopes;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_alwaysScopes);
  }

  @override
  final String? webauthnCredentialId;
  @override
  final String? keypairDeliveredAt;
  @override
  final String? lastConnectedAt;
  @override
  final String? lastActive;
  @override
  final String? createdAt;
  @override
  final String? cloudProvisioningStatus;
  @override
  final String? cloudRunnerId;
  @override
  final String? cloudLastHeartbeatAt;
  @override
  final String? cloudProvisioningError;
  @override
  final String? hybridLastHeartbeatAt;
  @override
  final String? agentKind;

  @override
  String toString() {
    return 'AgentDTO(id: $id, userId: $userId, orgId: $orgId, did: $did, publicKey: $publicKey, name: $name, description: $description, status: $status, runtime: $runtime, model: $model, localInferenceMode: $localInferenceMode, llmMode: $llmMode, permissionScopes: $permissionScopes, jitScopes: $jitScopes, alwaysScopes: $alwaysScopes, webauthnCredentialId: $webauthnCredentialId, keypairDeliveredAt: $keypairDeliveredAt, lastConnectedAt: $lastConnectedAt, lastActive: $lastActive, createdAt: $createdAt, cloudProvisioningStatus: $cloudProvisioningStatus, cloudRunnerId: $cloudRunnerId, cloudLastHeartbeatAt: $cloudLastHeartbeatAt, cloudProvisioningError: $cloudProvisioningError, hybridLastHeartbeatAt: $hybridLastHeartbeatAt, agentKind: $agentKind)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$AgentDTOImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.userId, userId) || other.userId == userId) &&
            (identical(other.orgId, orgId) || other.orgId == orgId) &&
            (identical(other.did, did) || other.did == did) &&
            (identical(other.publicKey, publicKey) ||
                other.publicKey == publicKey) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.description, description) ||
                other.description == description) &&
            (identical(other.status, status) || other.status == status) &&
            (identical(other.runtime, runtime) || other.runtime == runtime) &&
            (identical(other.model, model) || other.model == model) &&
            (identical(other.localInferenceMode, localInferenceMode) ||
                other.localInferenceMode == localInferenceMode) &&
            (identical(other.llmMode, llmMode) || other.llmMode == llmMode) &&
            const DeepCollectionEquality().equals(
              other._permissionScopes,
              _permissionScopes,
            ) &&
            const DeepCollectionEquality().equals(
              other._jitScopes,
              _jitScopes,
            ) &&
            const DeepCollectionEquality().equals(
              other._alwaysScopes,
              _alwaysScopes,
            ) &&
            (identical(other.webauthnCredentialId, webauthnCredentialId) ||
                other.webauthnCredentialId == webauthnCredentialId) &&
            (identical(other.keypairDeliveredAt, keypairDeliveredAt) ||
                other.keypairDeliveredAt == keypairDeliveredAt) &&
            (identical(other.lastConnectedAt, lastConnectedAt) ||
                other.lastConnectedAt == lastConnectedAt) &&
            (identical(other.lastActive, lastActive) ||
                other.lastActive == lastActive) &&
            (identical(other.createdAt, createdAt) ||
                other.createdAt == createdAt) &&
            (identical(
                  other.cloudProvisioningStatus,
                  cloudProvisioningStatus,
                ) ||
                other.cloudProvisioningStatus == cloudProvisioningStatus) &&
            (identical(other.cloudRunnerId, cloudRunnerId) ||
                other.cloudRunnerId == cloudRunnerId) &&
            (identical(other.cloudLastHeartbeatAt, cloudLastHeartbeatAt) ||
                other.cloudLastHeartbeatAt == cloudLastHeartbeatAt) &&
            (identical(other.cloudProvisioningError, cloudProvisioningError) ||
                other.cloudProvisioningError == cloudProvisioningError) &&
            (identical(other.hybridLastHeartbeatAt, hybridLastHeartbeatAt) ||
                other.hybridLastHeartbeatAt == hybridLastHeartbeatAt) &&
            (identical(other.agentKind, agentKind) ||
                other.agentKind == agentKind));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hashAll([
    runtimeType,
    id,
    userId,
    orgId,
    did,
    publicKey,
    name,
    description,
    status,
    runtime,
    model,
    localInferenceMode,
    llmMode,
    const DeepCollectionEquality().hash(_permissionScopes),
    const DeepCollectionEquality().hash(_jitScopes),
    const DeepCollectionEquality().hash(_alwaysScopes),
    webauthnCredentialId,
    keypairDeliveredAt,
    lastConnectedAt,
    lastActive,
    createdAt,
    cloudProvisioningStatus,
    cloudRunnerId,
    cloudLastHeartbeatAt,
    cloudProvisioningError,
    hybridLastHeartbeatAt,
    agentKind,
  ]);

  /// Create a copy of AgentDTO
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$AgentDTOImplCopyWith<_$AgentDTOImpl> get copyWith =>
      __$$AgentDTOImplCopyWithImpl<_$AgentDTOImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$AgentDTOImplToJson(this);
  }
}

abstract class _AgentDTO implements AgentDTO {
  const factory _AgentDTO({
    required final String id,
    required final String userId,
    final String? orgId,
    final String did,
    final String publicKey,
    required final String name,
    final String? description,
    final String status,
    final String runtime,
    final String model,
    final String? localInferenceMode,
    final String llmMode,
    final List<String> permissionScopes,
    final List<String> jitScopes,
    final List<String> alwaysScopes,
    final String? webauthnCredentialId,
    final String? keypairDeliveredAt,
    final String? lastConnectedAt,
    final String? lastActive,
    final String? createdAt,
    final String? cloudProvisioningStatus,
    final String? cloudRunnerId,
    final String? cloudLastHeartbeatAt,
    final String? cloudProvisioningError,
    final String? hybridLastHeartbeatAt,
    final String? agentKind,
  }) = _$AgentDTOImpl;

  factory _AgentDTO.fromJson(Map<String, dynamic> json) =
      _$AgentDTOImpl.fromJson;

  @override
  String get id;
  @override
  String get userId;
  @override
  String? get orgId;
  @override
  String get did;
  @override
  String get publicKey;
  @override
  String get name;
  @override
  String? get description;
  @override
  String get status;
  @override
  String get runtime;
  @override
  String get model;
  @override
  String? get localInferenceMode;
  @override
  String get llmMode;
  @override
  List<String> get permissionScopes;
  @override
  List<String> get jitScopes;
  @override
  List<String> get alwaysScopes;
  @override
  String? get webauthnCredentialId;
  @override
  String? get keypairDeliveredAt;
  @override
  String? get lastConnectedAt;
  @override
  String? get lastActive;
  @override
  String? get createdAt;
  @override
  String? get cloudProvisioningStatus;
  @override
  String? get cloudRunnerId;
  @override
  String? get cloudLastHeartbeatAt;
  @override
  String? get cloudProvisioningError;
  @override
  String? get hybridLastHeartbeatAt;
  @override
  String? get agentKind;

  /// Create a copy of AgentDTO
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$AgentDTOImplCopyWith<_$AgentDTOImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

VerifiableCredentialDTO _$VerifiableCredentialDTOFromJson(
  Map<String, dynamic> json,
) {
  return _VerifiableCredentialDTO.fromJson(json);
}

/// @nodoc
mixin _$VerifiableCredentialDTO {
  String get id => throw _privateConstructorUsedError;
  String get agentId => throw _privateConstructorUsedError;
  String get agentDid => throw _privateConstructorUsedError;
  String get type => throw _privateConstructorUsedError;
  String get issuerDid => throw _privateConstructorUsedError;
  String get subjectDid => throw _privateConstructorUsedError;
  @JsonKey(includeFromJson: true, includeToJson: true)
  dynamic get claims => throw _privateConstructorUsedError;
  String get signature => throw _privateConstructorUsedError;
  String? get issuedAt => throw _privateConstructorUsedError;
  String? get expiresAt => throw _privateConstructorUsedError;
  String? get revokedAt => throw _privateConstructorUsedError;

  /// Serializes this VerifiableCredentialDTO to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of VerifiableCredentialDTO
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $VerifiableCredentialDTOCopyWith<VerifiableCredentialDTO> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $VerifiableCredentialDTOCopyWith<$Res> {
  factory $VerifiableCredentialDTOCopyWith(
    VerifiableCredentialDTO value,
    $Res Function(VerifiableCredentialDTO) then,
  ) = _$VerifiableCredentialDTOCopyWithImpl<$Res, VerifiableCredentialDTO>;
  @useResult
  $Res call({
    String id,
    String agentId,
    String agentDid,
    String type,
    String issuerDid,
    String subjectDid,
    @JsonKey(includeFromJson: true, includeToJson: true) dynamic claims,
    String signature,
    String? issuedAt,
    String? expiresAt,
    String? revokedAt,
  });
}

/// @nodoc
class _$VerifiableCredentialDTOCopyWithImpl<
  $Res,
  $Val extends VerifiableCredentialDTO
>
    implements $VerifiableCredentialDTOCopyWith<$Res> {
  _$VerifiableCredentialDTOCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of VerifiableCredentialDTO
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? agentId = null,
    Object? agentDid = null,
    Object? type = null,
    Object? issuerDid = null,
    Object? subjectDid = null,
    Object? claims = freezed,
    Object? signature = null,
    Object? issuedAt = freezed,
    Object? expiresAt = freezed,
    Object? revokedAt = freezed,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            agentId: null == agentId
                ? _value.agentId
                : agentId // ignore: cast_nullable_to_non_nullable
                      as String,
            agentDid: null == agentDid
                ? _value.agentDid
                : agentDid // ignore: cast_nullable_to_non_nullable
                      as String,
            type: null == type
                ? _value.type
                : type // ignore: cast_nullable_to_non_nullable
                      as String,
            issuerDid: null == issuerDid
                ? _value.issuerDid
                : issuerDid // ignore: cast_nullable_to_non_nullable
                      as String,
            subjectDid: null == subjectDid
                ? _value.subjectDid
                : subjectDid // ignore: cast_nullable_to_non_nullable
                      as String,
            claims: freezed == claims
                ? _value.claims
                : claims // ignore: cast_nullable_to_non_nullable
                      as dynamic,
            signature: null == signature
                ? _value.signature
                : signature // ignore: cast_nullable_to_non_nullable
                      as String,
            issuedAt: freezed == issuedAt
                ? _value.issuedAt
                : issuedAt // ignore: cast_nullable_to_non_nullable
                      as String?,
            expiresAt: freezed == expiresAt
                ? _value.expiresAt
                : expiresAt // ignore: cast_nullable_to_non_nullable
                      as String?,
            revokedAt: freezed == revokedAt
                ? _value.revokedAt
                : revokedAt // ignore: cast_nullable_to_non_nullable
                      as String?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$VerifiableCredentialDTOImplCopyWith<$Res>
    implements $VerifiableCredentialDTOCopyWith<$Res> {
  factory _$$VerifiableCredentialDTOImplCopyWith(
    _$VerifiableCredentialDTOImpl value,
    $Res Function(_$VerifiableCredentialDTOImpl) then,
  ) = __$$VerifiableCredentialDTOImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    String agentId,
    String agentDid,
    String type,
    String issuerDid,
    String subjectDid,
    @JsonKey(includeFromJson: true, includeToJson: true) dynamic claims,
    String signature,
    String? issuedAt,
    String? expiresAt,
    String? revokedAt,
  });
}

/// @nodoc
class __$$VerifiableCredentialDTOImplCopyWithImpl<$Res>
    extends
        _$VerifiableCredentialDTOCopyWithImpl<
          $Res,
          _$VerifiableCredentialDTOImpl
        >
    implements _$$VerifiableCredentialDTOImplCopyWith<$Res> {
  __$$VerifiableCredentialDTOImplCopyWithImpl(
    _$VerifiableCredentialDTOImpl _value,
    $Res Function(_$VerifiableCredentialDTOImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of VerifiableCredentialDTO
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? agentId = null,
    Object? agentDid = null,
    Object? type = null,
    Object? issuerDid = null,
    Object? subjectDid = null,
    Object? claims = freezed,
    Object? signature = null,
    Object? issuedAt = freezed,
    Object? expiresAt = freezed,
    Object? revokedAt = freezed,
  }) {
    return _then(
      _$VerifiableCredentialDTOImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        agentId: null == agentId
            ? _value.agentId
            : agentId // ignore: cast_nullable_to_non_nullable
                  as String,
        agentDid: null == agentDid
            ? _value.agentDid
            : agentDid // ignore: cast_nullable_to_non_nullable
                  as String,
        type: null == type
            ? _value.type
            : type // ignore: cast_nullable_to_non_nullable
                  as String,
        issuerDid: null == issuerDid
            ? _value.issuerDid
            : issuerDid // ignore: cast_nullable_to_non_nullable
                  as String,
        subjectDid: null == subjectDid
            ? _value.subjectDid
            : subjectDid // ignore: cast_nullable_to_non_nullable
                  as String,
        claims: freezed == claims
            ? _value.claims
            : claims // ignore: cast_nullable_to_non_nullable
                  as dynamic,
        signature: null == signature
            ? _value.signature
            : signature // ignore: cast_nullable_to_non_nullable
                  as String,
        issuedAt: freezed == issuedAt
            ? _value.issuedAt
            : issuedAt // ignore: cast_nullable_to_non_nullable
                  as String?,
        expiresAt: freezed == expiresAt
            ? _value.expiresAt
            : expiresAt // ignore: cast_nullable_to_non_nullable
                  as String?,
        revokedAt: freezed == revokedAt
            ? _value.revokedAt
            : revokedAt // ignore: cast_nullable_to_non_nullable
                  as String?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$VerifiableCredentialDTOImpl implements _VerifiableCredentialDTO {
  const _$VerifiableCredentialDTOImpl({
    required this.id,
    required this.agentId,
    this.agentDid = '',
    this.type = 'identity',
    this.issuerDid = '',
    this.subjectDid = '',
    @JsonKey(includeFromJson: true, includeToJson: true) this.claims,
    this.signature = '',
    this.issuedAt,
    this.expiresAt,
    this.revokedAt,
  });

  factory _$VerifiableCredentialDTOImpl.fromJson(Map<String, dynamic> json) =>
      _$$VerifiableCredentialDTOImplFromJson(json);

  @override
  final String id;
  @override
  final String agentId;
  @override
  @JsonKey()
  final String agentDid;
  @override
  @JsonKey()
  final String type;
  @override
  @JsonKey()
  final String issuerDid;
  @override
  @JsonKey()
  final String subjectDid;
  @override
  @JsonKey(includeFromJson: true, includeToJson: true)
  final dynamic claims;
  @override
  @JsonKey()
  final String signature;
  @override
  final String? issuedAt;
  @override
  final String? expiresAt;
  @override
  final String? revokedAt;

  @override
  String toString() {
    return 'VerifiableCredentialDTO(id: $id, agentId: $agentId, agentDid: $agentDid, type: $type, issuerDid: $issuerDid, subjectDid: $subjectDid, claims: $claims, signature: $signature, issuedAt: $issuedAt, expiresAt: $expiresAt, revokedAt: $revokedAt)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$VerifiableCredentialDTOImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.agentId, agentId) || other.agentId == agentId) &&
            (identical(other.agentDid, agentDid) ||
                other.agentDid == agentDid) &&
            (identical(other.type, type) || other.type == type) &&
            (identical(other.issuerDid, issuerDid) ||
                other.issuerDid == issuerDid) &&
            (identical(other.subjectDid, subjectDid) ||
                other.subjectDid == subjectDid) &&
            const DeepCollectionEquality().equals(other.claims, claims) &&
            (identical(other.signature, signature) ||
                other.signature == signature) &&
            (identical(other.issuedAt, issuedAt) ||
                other.issuedAt == issuedAt) &&
            (identical(other.expiresAt, expiresAt) ||
                other.expiresAt == expiresAt) &&
            (identical(other.revokedAt, revokedAt) ||
                other.revokedAt == revokedAt));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    agentId,
    agentDid,
    type,
    issuerDid,
    subjectDid,
    const DeepCollectionEquality().hash(claims),
    signature,
    issuedAt,
    expiresAt,
    revokedAt,
  );

  /// Create a copy of VerifiableCredentialDTO
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$VerifiableCredentialDTOImplCopyWith<_$VerifiableCredentialDTOImpl>
  get copyWith =>
      __$$VerifiableCredentialDTOImplCopyWithImpl<
        _$VerifiableCredentialDTOImpl
      >(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$VerifiableCredentialDTOImplToJson(this);
  }
}

abstract class _VerifiableCredentialDTO implements VerifiableCredentialDTO {
  const factory _VerifiableCredentialDTO({
    required final String id,
    required final String agentId,
    final String agentDid,
    final String type,
    final String issuerDid,
    final String subjectDid,
    @JsonKey(includeFromJson: true, includeToJson: true) final dynamic claims,
    final String signature,
    final String? issuedAt,
    final String? expiresAt,
    final String? revokedAt,
  }) = _$VerifiableCredentialDTOImpl;

  factory _VerifiableCredentialDTO.fromJson(Map<String, dynamic> json) =
      _$VerifiableCredentialDTOImpl.fromJson;

  @override
  String get id;
  @override
  String get agentId;
  @override
  String get agentDid;
  @override
  String get type;
  @override
  String get issuerDid;
  @override
  String get subjectDid;
  @override
  @JsonKey(includeFromJson: true, includeToJson: true)
  dynamic get claims;
  @override
  String get signature;
  @override
  String? get issuedAt;
  @override
  String? get expiresAt;
  @override
  String? get revokedAt;

  /// Create a copy of VerifiableCredentialDTO
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$VerifiableCredentialDTOImplCopyWith<_$VerifiableCredentialDTOImpl>
  get copyWith => throw _privateConstructorUsedError;
}
