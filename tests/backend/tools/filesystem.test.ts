import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile, listDir, searchFiles, isUnderRoot } from '../../../src/backend/tools/filesystem'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TMP = 'tests/tmp-fs'

describe('isUnderRoot — path allowlist boundary', () => {
  const root = 'C:\\Users\\tim'

  it('accepts the root itself and paths under it', () => {
    expect(isUnderRoot('C:\\Users\\tim', root)).toBe(true)
    expect(isUnderRoot('C:\\Users\\tim\\Documents\\a.txt', root)).toBe(true)
  })

  it('rejects sibling directories that merely share the prefix', () => {
    // The bug a bare startsWith() allowed: C:\Users\tim-backup passes "starts with C:\Users\tim".
    expect(isUnderRoot('C:\\Users\\tim-backup\\secret.txt', root)).toBe(false)
    expect(isUnderRoot('C:\\Users\\timothy\\x', root)).toBe(false)
    expect(isUnderRoot('C:\\Users\\tim.bak', root)).toBe(false)
  })

  it('rejects unrelated paths', () => {
    expect(isUnderRoot('C:\\Windows\\system32', root)).toBe(false)
  })

  it('handles a root that already ends with a separator', () => {
    expect(isUnderRoot('C:\\Users\\tim\\a', 'C:\\Users\\tim\\')).toBe(true)
    expect(isUnderRoot('C:\\Users\\tim-x', 'C:\\Users\\tim\\')).toBe(false)
  })
})

describe('filesystem tools', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'hello.txt'), 'Hello Jarvis')
    writeFileSync(join(TMP, 'notes.txt'), 'Meeting notes')
  })

  afterEach(() => rmSync(TMP, { recursive: true, force: true }))

  it('readFile returns file contents', async () => {
    const result = await readFile(join(TMP, 'hello.txt'))
    expect(result).toBe('Hello Jarvis')
  })

  it('listDir returns file names', async () => {
    const result = await listDir(TMP)
    expect(result).toContain('hello.txt')
    expect(result).toContain('notes.txt')
  })

  it('searchFiles finds files by name pattern', async () => {
    const result = await searchFiles(TMP, 'notes')
    expect(result.some(f => f.includes('notes.txt'))).toBe(true)
  })

  it('readFile rejects paths outside allowed roots', async () => {
    await expect(readFile('C:\\Windows\\jarvis-nonexistent.txt')).rejects.toThrow()
  })

  it('writeFile creates a readable file', async () => {
    const { writeFile } = await import('../../../src/backend/tools/filesystem')
    const target = join(TMP, 'written.txt')
    await writeFile(target, 'persisted content')
    const back = await readFile(target)
    expect(back).toBe('persisted content')
  })

  it('writeFile rejects paths outside allowed roots', async () => {
    const { writeFile } = await import('../../../src/backend/tools/filesystem')
    await expect(writeFile('C:\\Windows\\jarvis-nope.txt', 'x')).rejects.toThrow()
  })
})
