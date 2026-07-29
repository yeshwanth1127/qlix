/// Mirrors `DashboardHomeResponse` from `frontend/src/lib/dashboard-api.ts`.

class DashboardAgentRow {
  const DashboardAgentRow({
    required this.id,
    required this.name,
    required this.didShort,
    required this.actionsToday,
    required this.status,
    required this.statusDetail,
  });

  final String id;
  final String name;
  final String didShort;
  final int actionsToday;
  final String status; // online | idle | offline
  final String statusDetail;

  factory DashboardAgentRow.fromJson(Map<String, dynamic> json) {
    return DashboardAgentRow(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      didShort: json['didShort'] as String? ?? '',
      actionsToday: (json['actionsToday'] as num?)?.toInt() ?? 0,
      status: json['status'] as String? ?? 'offline',
      statusDetail: json['statusDetail'] as String? ?? '',
    );
  }
}

class DashboardAuditEvent {
  const DashboardAuditEvent({
    required this.id,
    required this.timeUtc,
    required this.agentName,
    required this.action,
    required this.result,
    required this.description,
  });

  final String id;
  final String timeUtc;
  final String agentName;
  final String action; // READ | WRITE | AUTH
  final String result; // Success | Blocked | Flagged
  final String description;

  factory DashboardAuditEvent.fromJson(Map<String, dynamic> json) {
    return DashboardAuditEvent(
      id: json['id'] as String? ?? '',
      timeUtc: json['timeUtc'] as String? ?? '',
      agentName: json['agentName'] as String? ?? '',
      action: json['action'] as String? ?? 'READ',
      result: json['result'] as String? ?? 'Success',
      description: json['description'] as String? ?? '',
    );
  }
}

sealed class DashboardMetrics {
  const DashboardMetrics();

  factory DashboardMetrics.fromJson(Map<String, dynamic> json) {
    final kind = json['kind'] as String? ?? 'individual';
    if (kind == 'organization') {
      return OrgDashboardMetrics(
        registeredAgents: (json['registeredAgents'] as num?)?.toInt() ?? 0,
        agentsActiveToday: (json['agentsActiveToday'] as num?)?.toInt() ?? 0,
        actionsThisWeek: (json['actionsThisWeek'] as num?)?.toInt() ?? 0,
        actionsWeekOverWeekPercent:
            (json['actionsWeekOverWeekPercent'] as num?)?.toDouble(),
        policyViolations: (json['policyViolations'] as num?)?.toInt() ?? 0,
      );
    }
    return IndividualDashboardMetrics(
      activeAgents: (json['activeAgents'] as num?)?.toInt() ?? 0,
      agentsOnline: (json['agentsOnline'] as num?)?.toInt() ?? 0,
      actionsToday: (json['actionsToday'] as num?)?.toInt() ?? 0,
      actionsVsYesterdayPercent:
          (json['actionsVsYesterdayPercent'] as num?)?.toDouble(),
      credentialsValid: (json['credentialsValid'] as num?)?.toInt() ?? 0,
    );
  }
}

class IndividualDashboardMetrics extends DashboardMetrics {
  const IndividualDashboardMetrics({
    required this.activeAgents,
    required this.agentsOnline,
    required this.actionsToday,
    this.actionsVsYesterdayPercent,
    required this.credentialsValid,
  });

  final int activeAgents;
  final int agentsOnline;
  final int actionsToday;
  final double? actionsVsYesterdayPercent;
  final int credentialsValid;
}

class OrgDashboardMetrics extends DashboardMetrics {
  const OrgDashboardMetrics({
    required this.registeredAgents,
    required this.agentsActiveToday,
    required this.actionsThisWeek,
    this.actionsWeekOverWeekPercent,
    required this.policyViolations,
  });

  final int registeredAgents;
  final int agentsActiveToday;
  final int actionsThisWeek;
  final double? actionsWeekOverWeekPercent;
  final int policyViolations;
}

class DashboardHome {
  const DashboardHome({
    required this.workspaceKind,
    required this.organizationName,
    required this.userDisplayName,
    required this.userEmail,
    required this.metrics,
    required this.agents,
    required this.auditEvents,
  });

  final String workspaceKind;
  final String organizationName;
  final String? userDisplayName;
  final String userEmail;
  final DashboardMetrics metrics;
  final List<DashboardAgentRow> agents;
  final List<DashboardAuditEvent> auditEvents;

  factory DashboardHome.fromJson(Map<String, dynamic> json) {
    final org = json['organization'];
    final user = json['user'];
    final metricsRaw = json['metrics'];
    final agentsRaw = json['agents'];
    final auditRaw = json['auditEvents'];

    return DashboardHome(
      workspaceKind: json['workspaceKind'] as String? ??
          (org is Map ? org['workspaceKind'] as String? : null) ??
          'individual',
      organizationName:
          org is Map ? (org['name'] as String? ?? '') : '',
      userDisplayName:
          user is Map ? user['displayName'] as String? : null,
      userEmail: user is Map ? (user['email'] as String? ?? '') : '',
      metrics: metricsRaw is Map<String, dynamic>
          ? DashboardMetrics.fromJson(metricsRaw)
          : const IndividualDashboardMetrics(
              activeAgents: 0,
              agentsOnline: 0,
              actionsToday: 0,
              credentialsValid: 0,
            ),
      agents: agentsRaw is List
          ? agentsRaw
              .whereType<Map<String, dynamic>>()
              .map(DashboardAgentRow.fromJson)
              .toList()
          : const [],
      auditEvents: auditRaw is List
          ? auditRaw
              .whereType<Map<String, dynamic>>()
              .map(DashboardAuditEvent.fromJson)
              .toList()
          : const [],
    );
  }

  String get firstName {
    final name = userDisplayName?.trim();
    if (name != null && name.isNotEmpty) {
      return name.split(RegExp(r'\s+')).first;
    }
    final at = userEmail.indexOf('@');
    if (at > 0) return userEmail.substring(0, at);
    return userEmail;
  }
}
