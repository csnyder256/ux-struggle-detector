import { describe, it, expect } from 'vitest'
import { hashElementId, hashLabel, isElementId } from '@/lib/types/ui-map'

describe('hashElementId', () => {
  it('produces a sh_<32-hex> string', async () => {
    const id = await hashElementId({
      orgId: 'org_abc',
      filePath: 'src/Form.tsx',
      nodeDescriptor: 'Form>button[0]',
    })
    expect(isElementId(id)).toBe(true)
    expect(id).toMatch(/^sh_[0-9a-f]{32}$/)
  })

  it('is deterministic for identical inputs', async () => {
    const a = await hashElementId({
      orgId: 'org_x',
      filePath: 'a/b.tsx',
      nodeDescriptor: 'X>button[2]',
    })
    const b = await hashElementId({
      orgId: 'org_x',
      filePath: 'a/b.tsx',
      nodeDescriptor: 'X>button[2]',
    })
    expect(a).toBe(b)
  })

  it('changes when orgId changes', async () => {
    const a = await hashElementId({
      orgId: 'org_1',
      filePath: 'p.tsx',
      nodeDescriptor: 'B>a[0]',
    })
    const b = await hashElementId({
      orgId: 'org_2',
      filePath: 'p.tsx',
      nodeDescriptor: 'B>a[0]',
    })
    expect(a).not.toBe(b)
  })

  it('changes when nodeDescriptor changes', async () => {
    const a = await hashElementId({
      orgId: 'org_x',
      filePath: 'p.tsx',
      nodeDescriptor: 'B>a[0]',
    })
    const b = await hashElementId({
      orgId: 'org_x',
      filePath: 'p.tsx',
      nodeDescriptor: 'B>a[1]',
    })
    expect(a).not.toBe(b)
  })

  it('changes when filePath changes', async () => {
    const a = await hashElementId({
      orgId: 'org_x',
      filePath: 'src/a.tsx',
      nodeDescriptor: 'B>a[0]',
    })
    const b = await hashElementId({
      orgId: 'org_x',
      filePath: 'src/b.tsx',
      nodeDescriptor: 'B>a[0]',
    })
    expect(a).not.toBe(b)
  })
})

describe('isElementId', () => {
  it('accepts a well-formed id', () => {
    expect(isElementId('sh_0123456789abcdef0123456789abcdef')).toBe(true)
  })
  it('rejects bad prefix', () => {
    expect(isElementId('xx_0123456789abcdef0123456789abcdef')).toBe(false)
  })
  it('rejects wrong length', () => {
    expect(isElementId('sh_deadbeef')).toBe(false)
  })
  it('rejects non-hex chars', () => {
    expect(isElementId('sh_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false)
  })
})

describe('hashLabel', () => {
  it('is deterministic and NFC-normalized', async () => {
    const a = await hashLabel('Café')
    const b = await hashLabel('Café'.normalize('NFD'))
    expect(a).toBe(b) // both normalized to NFC inside the function
  })

  it('hex output of expected length', async () => {
    const h = await hashLabel('Hello')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})
