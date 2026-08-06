/** Route slugs for AI Employees — full pack data comes from GET /api/v1/employees/roles. */
export const AI_EMPLOYEE_ROLE_SLUGS = [
  "sales-executive",
  "accountant",
  "receptionist",
  "recruiter",
  "customer-support",
  "hr-manager",
] as const;

export type AiEmployeeRoleSlug = (typeof AI_EMPLOYEE_ROLE_SLUGS)[number];

/** @deprecated Use RoleCatalogEntry from employees-api after fetch. */
export const AI_EMPLOYEE_ROLES = [
  { slug: "sales-executive", label: "Sales Executive" },
  { slug: "accountant", label: "Accountant" },
  { slug: "receptionist", label: "Receptionist" },
  { slug: "recruiter", label: "Recruiter" },
  { slug: "customer-support", label: "Customer Support" },
  { slug: "hr-manager", label: "HR Manager" },
] as const;

export type AiEmployeeRole = (typeof AI_EMPLOYEE_ROLES)[number];

export function getAiEmployeeRole(slug: string): AiEmployeeRole | undefined {
  return AI_EMPLOYEE_ROLES.find((role) => role.slug === slug);
}

export function isAiEmployeeRoleSlug(slug: string): slug is AiEmployeeRoleSlug {
  return (AI_EMPLOYEE_ROLE_SLUGS as readonly string[]).includes(slug);
}
