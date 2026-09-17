import type { ToolCallResult } from 'claude-code'

import type { ToolEvent } from '../../../hooks/core/ledger'

/** A finished tool call as rowOf takes it: the flat tool.call envelope and the result. */
export type Call = { e: ToolEvent; result: ToolCallResult }
