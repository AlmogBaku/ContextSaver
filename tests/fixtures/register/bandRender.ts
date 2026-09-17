import type { RenderInput } from 'claude-code'

/**
 * The band above the prompt at a given width: drawing it is how the plugin learns the columns.
 *
 * @param bodyColumns cells across the band
 * @param hasSurvey whether the engine is asking the person something (the band stands down)
 */
export const bandRender = (bodyColumns: number, hasSurvey = false): RenderInput<'AbovePrompt'> => ({
  component: 'AbovePrompt',
  surface: 'terminal',
  requestId: 'band',
  viewport: { columns: bodyColumns, rows: 40 },
  props: { hasSurvey, isWorking: false, maxRows: 8, bodyColumns, scroll: { offset: 0, bodyRows: 7 }, view: {} },
})
