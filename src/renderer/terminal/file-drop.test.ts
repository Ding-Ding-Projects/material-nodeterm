import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  canvasImageFiles,
  canvasImageSink,
  clipboardImages,
  droppedPaths,
  escapeDroppedPath,
  localPathsForFiles,
  pasteHasText,
  pastedFiles,
  uploadNameFor,
  type FileDropApi
} from './file-drop'

describe('escapeDroppedPath', () => {
  it('escapes what a shell would otherwise interpret', () => {
    expect(escapeDroppedPath('/tmp/Bishop Drew order.xlsx')).toBe('/tmp/Bishop\\ Drew\\ order.xlsx')
    expect(escapeDroppedPath("/tmp/a'b$c")).toBe("/tmp/a\\'b\\$c")
  })
})

describe('uploadNameFor', () => {
  it('keeps the file s own name when it has one', () => {
    expect(uploadNameFor(new File(['x'], 'report.pdf', { type: 'application/pdf' }))).toBe(
      'report.pdf'
    )
  })

  it('names clipboard bytes by their type — an agent should not have to guess', () => {
    // A screenshot arrives as image/png with an EMPTY name; a suffix-less `pasted-<ts>` tells
    // whatever reads the prompt nothing about what it is holding.
    const name = uploadNameFor(new File(['x'], '', { type: 'image/png' }))
    expect(name).toMatch(/^pasted-\d{8}-\d{6}\.png$/)
    expect(uploadNameFor(new File(['x'], '', { type: 'image/jpeg' }))).toMatch(/\.jpg$/)
  })

  it('falls back to the subtype, then to .bin, for a type it has no table entry for', () => {
    expect(uploadNameFor(new File(['x'], '', { type: 'audio/ogg' }))).toMatch(/\.ogg$/)
    expect(uploadNameFor(new File(['x'], '', { type: '' }))).toMatch(/\.bin$/)
  })
})

/** Minimal stand-in for the shapes Chromium actually hands a paste. */
const clipboard = (opts: { files?: File[]; items?: File[]; text?: string }): DataTransfer =>
  ({
    files: (opts.files ?? []) as unknown as FileList,
    items: (opts.items ?? []).map((f) => ({ kind: 'file', getAsFile: () => f })) as unknown as
      DataTransferItemList,
    getData: (type: string) => (type === 'text/plain' ? (opts.text ?? '') : '')
  }) as DataTransfer

describe('pastedFiles', () => {
  const png = new File(['x'], 'a.png', { type: 'image/png' })

  it('reads an OS file-manager copy off `files`', () => {
    expect(pastedFiles(clipboard({ files: [png] }))).toEqual([png])
  })

  it('reads raw clipboard bytes off `items` — a screenshot never reaches `files`', () => {
    expect(pastedFiles(clipboard({ items: [png] }))).toEqual([png])
  })

  it('answers empty for a text paste, which is xterm s to handle', () => {
    expect(pastedFiles(clipboard({}))).toEqual([])
    expect(pastedFiles(null)).toEqual([])
  })
})

describe('canvasImageFiles', () => {
  it('keeps MIME images and known image extensions only', () => {
    const png = new File(['png'], 'shot.png', { type: 'image/png' })
    const avif = new File(['avif'], 'photo.AVIF')
    const text = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    expect(canvasImageFiles([png, avif, text])).toEqual([png, avif])
  })
})

describe('localPathsForFiles', () => {
  afterEach(() => vi.unstubAllGlobals())

  const fileReader = (): void => {
    // The suite runs on the node environment, which has no FileReader; only the base64 handoff
    // matters here, so the read is the smallest stand-in that produces one.
    vi.stubGlobal(
      'FileReader',
      class {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        result: string | null = null
        readAsDataURL(): void {
          this.result = 'data:image/png;base64,cG5n'
          this.onload?.()
        }
      }
    )
  }

  const api = (opts: {
    getPathForFile?: (file: File) => string
    saveUpload?: (name: string, data: string) => Promise<string | null>
    saveUploadBlob?: (name: string, data: Blob) => Promise<string | null>
    saveCanvasImage?: (projectId: string, name: string, data: string) => Promise<string | null>
    uploadFile?: (projectId: string, localPath: string, name: string) => Promise<string | null>
  }): FileDropApi =>
    ({
      getPathForFile: opts.getPathForFile ?? (() => ''),
      files: {
        saveUpload: opts.saveUpload ?? vi.fn(async () => null),
        ...(opts.saveUploadBlob ? { saveUploadBlob: opts.saveUploadBlob } : {}),
        saveCanvasImage: opts.saveCanvasImage ?? vi.fn(async () => null)
      },
      sshProject: {
        uploadFile: opts.uploadFile ?? vi.fn(async () => null)
      }
    }) as unknown as FileDropApi

  const forbidGlobalFileRouting = () => {
    const getPathForFile = vi.fn(() => '/viewer/wrong-machine.png')
    const saveUpload = vi.fn(async () => '/viewer/wrong-upload.png')
    const saveCanvasImage = vi.fn(async () => '/viewer/wrong-canvas.png')
    const uploadFile = vi.fn(async () => '/viewer/wrong-ssh.png')
    vi.stubGlobal('window', {
      nodeTerminal: {
        getPathForFile,
        files: { saveUpload, saveCanvasImage },
        sshProject: { uploadFile }
      }
    })
    return { getPathForFile, saveUpload, saveCanvasImage, uploadFile }
  }

  it('routes pathless canvas bytes through the active session api, never the global viewer api', async () => {
    fileReader()
    const global = forbidGlobalFileRouting()
    const saveUpload = vi.fn()
    const saveCanvasImage = vi.fn().mockResolvedValue('/proj/.nodeterm/images/pasted.png')
    const active = api({ saveUpload, saveCanvasImage })
    const file = new File(['png'], 'pasted.png', { type: 'image/png' })
    expect(await localPathsForFiles(active, [file], canvasImageSink(active, 'project-a'))).toEqual([
      '/proj/.nodeterm/images/pasted.png'
    ])
    expect(saveCanvasImage).toHaveBeenCalledWith('project-a', 'pasted.png', expect.any(String))
    expect(saveUpload).not.toHaveBeenCalled()
    expect(global.getPathForFile).not.toHaveBeenCalled()
    expect(global.saveUpload).not.toHaveBeenCalled()
    expect(global.saveCanvasImage).not.toHaveBeenCalled()
  })

  it('uses a direct path only when the active session api says that path is usable', async () => {
    const global = forbidGlobalFileRouting()
    const saveCanvasImage = vi.fn()
    const getPathForFile = vi.fn(() => '/active/My image.png')
    const active = api({ getPathForFile, saveCanvasImage })
    const file = new File(['png'], 'My image.png', { type: 'image/png' })
    // A Finder drop already IS a file on this disk, so nothing is copied anywhere.
    expect(await localPathsForFiles(active, [file], canvasImageSink(active, 'project-a'))).toEqual([
      '/active/My image.png'
    ])
    expect(getPathForFile).toHaveBeenCalledWith(file)
    expect(saveCanvasImage).not.toHaveBeenCalled()
    expect(global.getPathForFile).not.toHaveBeenCalled()
  })

  it('stages terminal bytes and SSH uploads through the active session api only', async () => {
    fileReader()
    const global = forbidGlobalFileRouting()
    const saveUpload = vi.fn(async () => '/host/uploads/pasted.png')
    const uploadFile = vi.fn(async () => '/ssh/home/.nodeterm/uploads/pasted.png')
    const active = api({ saveUpload, uploadFile })
    const file = new File(['png'], 'pasted.png', { type: 'image/png' })

    await expect(
      droppedPaths(active, [file], { sshRemoteTmux: false, projectId: '' })
    ).resolves.toEqual(['/host/uploads/pasted.png'])
    await expect(
      droppedPaths(active, [file], { sshRemoteTmux: true, projectId: 'ssh-project' })
    ).resolves.toEqual(['/ssh/home/.nodeterm/uploads/pasted.png'])

    expect(saveUpload).toHaveBeenCalledTimes(2)
    expect(uploadFile).toHaveBeenCalledWith(
      'ssh-project',
      '/host/uploads/pasted.png',
      'pasted.png'
    )
    expect(global.getPathForFile).not.toHaveBeenCalled()
    expect(global.saveUpload).not.toHaveBeenCalled()
    expect(global.uploadFile).not.toHaveBeenCalled()
  })

  it('prefers the active Server Edition raw-Blob carrier without reading or base64-encoding', async () => {
    const global = forbidGlobalFileRouting()
    const saveUpload = vi.fn(async () => '/host/base64-should-not-run.png')
    const saveUploadBlob = vi.fn(async () => '/host/raw/pasted.png')
    const active = api({ saveUpload, saveUploadBlob })
    const file = new File(['png'], 'pasted.png', { type: 'image/png' })

    await expect(
      droppedPaths(active, [file], { sshRemoteTmux: false, projectId: '' })
    ).resolves.toEqual(['/host/raw/pasted.png'])
    expect(saveUploadBlob).toHaveBeenCalledWith('pasted.png', file)
    expect(saveUpload).not.toHaveBeenCalled()
    expect(global.getPathForFile).not.toHaveBeenCalled()
    expect(global.saveUpload).not.toHaveBeenCalled()
  })

  it('degrades a refused session SSH upload to no pasted path without falling back globally', async () => {
    const global = forbidGlobalFileRouting()
    const uploadFile = vi.fn(async () => {
      throw Object.assign(new Error('unsupported'), { code: 'E_UNSUPPORTED' })
    })
    const active = api({
      getPathForFile: () => '/host/uploads/pasted.png',
      uploadFile
    })
    const file = new File(['png'], 'pasted.png', { type: 'image/png' })

    await expect(
      droppedPaths(active, [file], { sshRemoteTmux: true, projectId: 'ssh-project' })
    ).resolves.toEqual([])
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(global.uploadFile).not.toHaveBeenCalled()
  })
})

describe('pasteHasText', () => {
  it('separates an ordinary text paste from one that carried nothing at all', () => {
    expect(pasteHasText(clipboard({ text: 'hello' }))).toBe(true)
    // The filtered image-only clipboard: Chromium hands over no files AND no text.
    expect(pasteHasText(clipboard({}))).toBe(false)
    expect(pasteHasText(null)).toBe(false)
  })
})

describe('clipboardImages', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** Stand-in for the async Clipboard API — `read()` is the only member touched. */
  const stubClipboard = (read: () => Promise<unknown[]>): void => {
    vi.stubGlobal('navigator', { clipboard: { read } })
  }

  const item = (types: string[]): unknown => ({
    types,
    getType: (t: string) => Promise.resolve(new Blob(['bytes'], { type: t }))
  })

  it('reads the screenshot the paste event filtered out, and names it', async () => {
    stubClipboard(async () => [item(['image/png'])])
    const [file] = await clipboardImages()
    expect(file.type).toBe('image/png')
    // A bare Blob has no name; without one the upload overlay and the agent both see nothing.
    expect(file.name).toMatch(/^pasted-\d{8}-\d{6}\.png$/)
  })

  it('ignores clipboard entries that hold no image', async () => {
    stubClipboard(async () => [item(['text/html', 'text/plain'])])
    expect(await clipboardImages()).toEqual([])
  })

  it('answers empty where the API is absent — an insecure context, or an older browser', async () => {
    vi.stubGlobal('navigator', {})
    expect(await clipboardImages()).toEqual([])
  })

  it('answers empty when the read is refused, leaving the paste the no-op it already was', async () => {
    stubClipboard(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
    expect(await clipboardImages()).toEqual([])
  })
})
