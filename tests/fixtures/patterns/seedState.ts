import { initialState } from '../../../hooks/core/types'
import type { State } from '../../../hooks/core/types'

/** A fresh session state over a 200k window, with whatever the test overrides. */
export const seedState = (over: Partial<State> = {}): State => ({ ...initialState('/work', 200_000), ...over })
