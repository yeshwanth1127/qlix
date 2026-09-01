import { publishDefenseInterviewWorkflow } from './defenseInterviewWorkflow.js';

/**
 * Publishes the defense-interview conversation workflow so assessment.review.ask
 * has something to start threads against. Run once per environment (idempotent —
 * re-running publishes a new version; existing threads stay pinned to whichever
 * version they started on). `npx tsx src/assessment/seedDefenseInterviewWorkflow.ts`
 */
async function main(): Promise<void> {
  const result = await publishDefenseInterviewWorkflow();
  console.log(
    `Published ${result.workflowVersionId} (version ${result.version}) for workflow key student_defense_interview_question.v1`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to publish defense interview workflow:', err);
    process.exit(1);
  });
