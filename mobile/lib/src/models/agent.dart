import 'package:freezed_annotation/freezed_annotation.dart';

part 'agent.freezed.dart';
part 'agent.g.dart';

/// Mirrors `AgentDTO` from `frontend/src/lib/agents-api.ts`.
///
/// Fields that the backend may omit for some runtimes are nullable or given
/// defaults so JSON parsing stays resilient to shape variations.
@freezed
class AgentDTO with _$AgentDTO {
  const factory AgentDTO({
    required String id,
    required String userId,
    String? orgId,
    @Default('') String did,
    @Default('') String publicKey,
    required String name,
    String? description,
    @Default('') String status,
    @Default('cloud') String runtime,
    @Default('') String model,
    String? localInferenceMode,
    @Default('direct') String llmMode,
    @Default(<String>[]) List<String> permissionScopes,
    @Default(<String>[]) List<String> jitScopes,
    @Default(<String>[]) List<String> alwaysScopes,
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
  }) = _AgentDTO;

  factory AgentDTO.fromJson(Map<String, dynamic> json) =>
      _$AgentDTOFromJson(json);
}

extension AgentRuntimeX on AgentDTO {
  /// Cloud and hybrid agents use dashboard chat + backend inference proxy.
  bool get isHostedChatRuntime => runtime == 'cloud' || runtime == 'hybrid';
}

/// Mirrors `VerifiableCredentialDTO` from `frontend/src/lib/agents-api.ts`.
@freezed
class VerifiableCredentialDTO with _$VerifiableCredentialDTO {
  const factory VerifiableCredentialDTO({
    required String id,
    required String agentId,
    @Default('') String agentDid,
    @Default('identity') String type,
    @Default('') String issuerDid,
    @Default('') String subjectDid,
    dynamic claims,
    @Default('') String signature,
    String? issuedAt,
    String? expiresAt,
    String? revokedAt,
  }) = _VerifiableCredentialDTO;

  factory VerifiableCredentialDTO.fromJson(Map<String, dynamic> json) =>
      _$VerifiableCredentialDTOFromJson(json);
}

/// Response shape for `GET /api/v1/agents/:id`.
class AgentDetail {
  const AgentDetail({required this.agent, required this.credentials});

  final AgentDTO agent;
  final List<VerifiableCredentialDTO> credentials;

  factory AgentDetail.fromJson(Map<String, dynamic> json) {
    final rawCreds = json['credentials'];
    final creds = rawCreds is List
        ? rawCreds
            .whereType<Map<String, dynamic>>()
            .map(VerifiableCredentialDTO.fromJson)
            .toList()
        : <VerifiableCredentialDTO>[];
    return AgentDetail(
      agent: AgentDTO.fromJson(json['agent'] as Map<String, dynamic>),
      credentials: creds,
    );
  }
}
