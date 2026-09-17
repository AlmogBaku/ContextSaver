import type { Call } from './call'

/** A NotebookEdit that replaced one cell, the path only on the event. */
export const notebookEdited: Call = {
  e: {
    tool: 'NotebookEdit',
    tool_use_id: 'call_13',
    notebook_path: '/w/notebooks/analysis.ipynb',
    cell_id: 'cell-3',
    new_source: 'import pandas as pd\n',
  },
  result: { result: { cell_id: 'cell-3', edit_mode: 'replace' }, text: 'Updated cell cell-3', ref: 14 },
}
