/** The result of a `Workflow` call that launched a local run. */
export const workflowLaunched: Record<string, unknown> = {
  status: 'async_launched',
  taskId: 'task_7',
  taskType: 'local_workflow',
  workflowName: 'proxy-rewrite',
  runId: 'w3',
  summary: 'Rewriting the proxy in four chunks',
  transcriptDir: '/tmp/runs/w3',
  scriptPath: '/tmp/runs/w3/workflow.ts',
}
