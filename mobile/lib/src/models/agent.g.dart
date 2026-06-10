// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'agent.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$AgentDTOImpl _$$AgentDTOImplFromJson(Map<String, dynamic> json) =>
    _$AgentDTOImpl(
      id: json['id'] as String,
      userId: json['userId'] as String,
      orgId: json['orgId'] as String?,
      did: json['did'] as String? ?? '',
      publicKey: json['publicKey'] as String? ?? '',
      name: json['name'] as String,
      description: json['description'] as String?,
      status: json['status'] as String? ?? '',
      runtime: json['runtime'] as String? ?? 'cloud',
      model: json['model'] as String? ?? '',
      localInferenceMode: json['localInferenceMode'] as String?,
      llmMode: json['llmMode'] as String? ?? 'direct',
      permissionScopes:
          (json['permissionScopes'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          const <String>[],
      jitScopes:
          (json['jitScopes'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          const <String>[],
      alwaysScopes:
          (json['alwaysScopes'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          const <String>[],
      webauthnCredentialId: json['webauthnCredentialId'] as String?,
      keypairDeliveredAt: json['keypairDeliveredAt'] as String?,
      lastConnectedAt: json['lastConnectedAt'] as String?,
      lastActive: json['lastActive'] as String?,
      createdAt: json['createdAt'] as String?,
      cloudProvisioningStatus: json['cloudProvisioningStatus'] as String?,
      cloudRunnerId: json['cloudRunnerId'] as String?,
      cloudLastHeartbeatAt: json['cloudLastHeartbeatAt'] as String?,
      cloudProvisioningError: json['cloudProvisioningError'] as String?,
      hybridLastHeartbeatAt: json['hybridLastHeartbeatAt'] as String?,
      agentKind: json['agentKind'] as String?,
    );

Map<String, dynamic> _$$AgentDTOImplToJson(_$AgentDTOImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'userId': instance.userId,
      'orgId': instance.orgId,
      'did': instance.did,
      'publicKey': instance.publicKey,
      'name': instance.name,
      'description': instance.description,
      'status': instance.status,
      'runtime': instance.runtime,
      'model': instance.model,
      'localInferenceMode': instance.localInferenceMode,
      'llmMode': instance.llmMode,
      'permissionScopes': instance.permissionScopes,
      'jitScopes': instance.jitScopes,
      'alwaysScopes': instance.alwaysScopes,
      'webauthnCredentialId': instance.webauthnCredentialId,
      'keypairDeliveredAt': instance.keypairDeliveredAt,
      'lastConnectedAt': instance.lastConnectedAt,
      'lastActive': instance.lastActive,
      'createdAt': instance.createdAt,
      'cloudProvisioningStatus': instance.cloudProvisioningStatus,
      'cloudRunnerId': instance.cloudRunnerId,
      'cloudLastHeartbeatAt': instance.cloudLastHeartbeatAt,
      'cloudProvisioningError': instance.cloudProvisioningError,
      'hybridLastHeartbeatAt': instance.hybridLastHeartbeatAt,
      'agentKind': instance.agentKind,
    };

_$VerifiableCredentialDTOImpl _$$VerifiableCredentialDTOImplFromJson(
  Map<String, dynamic> json,
) => _$VerifiableCredentialDTOImpl(
  id: json['id'] as String,
  agentId: json['agentId'] as String,
  agentDid: json['agentDid'] as String? ?? '',
  type: json['type'] as String? ?? 'identity',
  issuerDid: json['issuerDid'] as String? ?? '',
  subjectDid: json['subjectDid'] as String? ?? '',
  claims: json['claims'],
  signature: json['signature'] as String? ?? '',
  issuedAt: json['issuedAt'] as String?,
  expiresAt: json['expiresAt'] as String?,
  revokedAt: json['revokedAt'] as String?,
);

Map<String, dynamic> _$$VerifiableCredentialDTOImplToJson(
  _$VerifiableCredentialDTOImpl instance,
) => <String, dynamic>{
  'id': instance.id,
  'agentId': instance.agentId,
  'agentDid': instance.agentDid,
  'type': instance.type,
  'issuerDid': instance.issuerDid,
  'subjectDid': instance.subjectDid,
  'claims': instance.claims,
  'signature': instance.signature,
  'issuedAt': instance.issuedAt,
  'expiresAt': instance.expiresAt,
  'revokedAt': instance.revokedAt,
};
