/**
 * Stub parser used by every framework that we detect but don't yet have
 * an extractor for. The stub returns an empty UIMap and tags the failure
 * mode in a thrown NotYetImplementedError so the worker can decide whether
 * to skip vs surface to the user.
 */

import { NotYetImplementedError, emptyUIMap } from './types'
import type { Parser, ParseInput, UIMap } from '@/lib/types/ui-map'

export class StubParser implements Parser {
  constructor(public readonly id: string) {}

  async parse(_input: ParseInput): Promise<UIMap> {
    throw new NotYetImplementedError(this.id)
  }
}

/**
 * "Soft" stub that doesn't throw - returns an empty UIMap. Use when the
 * caller wants the mapping pipeline to keep going even if a particular
 * framework's parser hasn't been written yet.
 */
export class SoftStubParser implements Parser {
  constructor(public readonly id: string) {}

  async parse(input: ParseInput): Promise<UIMap> {
    return emptyUIMap(input.orgId)
  }
}
