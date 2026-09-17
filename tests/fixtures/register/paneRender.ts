import type { RenderInput } from 'claude-code'

/**
 * The ContextSaver pane docked on a wide terminal, 80 columns of body and 30 rows in view.
 *
 * @param requestId which pane is drawn ('saver' is ours)
 */
export const paneRender = (requestId = 'saver'): RenderInput<'Pane'> => ({
  component: 'Pane',
  surface: 'terminal',
  requestId,
  viewport: { columns: 160, rows: 40 },
  props: { title: 'ContextSaver', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
})
