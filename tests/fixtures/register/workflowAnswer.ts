import type { ToolCallResult } from 'claude-code'

/** What a `Workflow` call answers when it launched the local run `w3` of `proxy-rewrite`, journal under /tmp/runs/w3. */
export const workflowAnswer: ToolCallResult = {
  result: {
    status: 'async_launched',
    taskId: 'task_7',
    taskType: 'local_workflow',
    workflowName: 'proxy-rewrite',
    runId: 'w3',
    summary: 'Rewriting the proxy in four chunks',
    transcriptDir: '/tmp/runs/w3',
    scriptPath: '/tmp/runs/w3/workflow.ts',
  },
  text: 'Workflow proxy-rewrite launched (run w3)',
}
