/**
 * /publish/datasets/new — thin page wrapper around the shared
 * dataset form. The bulk of the form (cards, validators, submit
 * pipeline) lives in `components/dataset-form.ts`; this file
 * just calls it with `mode: 'create'` and a blank initial state.
 */

import {
  renderDatasetForm,
  type DatasetFormOptions,
} from '../components/dataset-form'

export type DatasetNewPageOptions = Omit<DatasetFormOptions, 'mode' | 'initial'>

export function renderDatasetNewPage(
  content: HTMLElement,
  options: DatasetNewPageOptions = {},
): void {
  renderDatasetForm(content, { mode: 'create', ...options })
}

// Re-export the ISO conversion helper so existing imports
// (`import { dateTimeToIso } from './dataset-new'`) keep working
// without modification. The function itself lives with the rest
// of the form in `components/dataset-form.ts`.
export { dateTimeToIso } from '../components/dataset-form'
