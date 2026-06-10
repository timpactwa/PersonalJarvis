import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile, listDir, searchFiles } from '../../../src/backend/tools/filesystem'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TMP = 'tests/tmp-fs'

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
