import { useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import type { NsisLocalPaths, NsisSpec } from '@shared/nsis-form-types'
import {
  NSIS_COMPRESSIONS,
  NSIS_COMPRESSION_LABELS,
  NSIS_INSTALL_ROOTS,
  NSIS_INSTALL_ROOT_LABELS,
  defaultNsisLocalPaths,
  defaultNsisSpec,
  nsisSpecIsComplete
} from '@shared/nsis-form-types'
import { renderNsisPreview } from '@shared/nsis-render'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Switch } from '../ui/Switch'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '@renderer/lib/regex/useRegexSearchField'
import { MaterialSymbol } from '../components/MaterialSymbol'

/**
 * A GUI for authoring a Windows NSIS installer script for ANOTHER project.
 *
 * This is deliberately NOT this app's own installer path -- nodeterm ships through
 * Squirrel.Windows and that never changes (see CLAUDE.md's Packaging section). What lives here is
 * a tool: a canvas object a user drags out beside the terminal they are building an installer
 * from, the same way an authenticator or a service manager is a tool on the canvas rather than a
 * settings-page modal.
 *
 * PERSISTENCE SPLIT (see `@shared/nsis-form-types` and `@shared/node-exec` for the full reasoning):
 *  - `data.nsisSpec` is GIT-SHARED -- app name, version, publisher, output filename, install root,
 *    shortcut/uninstaller/compression choices. None of it names a location on the local disk.
 *  - `data.nsisLocalPaths` is MACHINE-LOCAL -- absolute source/license/icon paths on THIS machine,
 *    round-tripped through `LocalNodeExec.nsisLocalPaths` exactly like a service node's
 *    `serviceConnection`, and for the identical reason: an absolute path is one person's disk.
 *
 * Per CLAUDE.md's guided-forms rule, every field here is a real control with a real default
 * rather than a blank box: install root and compression are closed `<Select>`s (never free text),
 * every path field has a native Browse button beside the (still-editable) text field, and the
 * script preview always renders SOMETHING -- with inline `; TODO:` placeholders for whatever is
 * still missing -- rather than an empty box.
 */
export default function NsisInstallerNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { deleteElements, updateNodeData } = useReactFlow()
  const spec: NsisSpec = (data.nsisSpec as NsisSpec | undefined) ?? defaultNsisSpec()
  const local: NsisLocalPaths =
    (data.nsisLocalPaths as NsisLocalPaths | undefined) ?? defaultNsisLocalPaths()
  const headerFill = nodeHeaderFillStyle(data.color)
  const [browseBusy, setBrowseBusy] = useState<'source' | 'license' | 'icon' | null>(null)

  const patchSpec = (patch: Partial<NsisSpec>): void => {
    updateNodeData(id, { nsisSpec: { ...spec, ...patch } })
  }
  const patchLocal = (patch: Partial<NsisLocalPaths>): void => {
    updateNodeData(id, { nsisLocalPaths: { ...local, ...patch } })
  }

  const search = useRegexSearchField({ mode: 'text' })
  const inputRef = useRef<HTMLInputElement>(null)
  const filteredSources = useMemo(
    () => local.sourcePaths.filter((p) => search.test(p)),
    [local.sourcePaths, search]
  )

  const addSourceFolder = async (): Promise<void> => {
    setBrowseBusy('source')
    try {
      const picked = await window.nodeTerminal.dialog.selectFolder()
      if (picked && !local.sourcePaths.includes(picked)) {
        patchLocal({ sourcePaths: [...local.sourcePaths, picked] })
      }
    } finally {
      setBrowseBusy(null)
    }
  }
  const addSourceFiles = async (): Promise<void> => {
    setBrowseBusy('source')
    try {
      const picked = await window.nodeTerminal.dialog.selectFiles()
      if (picked && picked.length) {
        const merged = [...local.sourcePaths]
        for (const p of picked) if (!merged.includes(p)) merged.push(p)
        patchLocal({ sourcePaths: merged })
      }
    } finally {
      setBrowseBusy(null)
    }
  }
  const removeSource = (path: string): void => {
    patchLocal({ sourcePaths: local.sourcePaths.filter((p) => p !== path) })
  }
  const browseLicense = async (): Promise<void> => {
    setBrowseBusy('license')
    try {
      const picked = await window.nodeTerminal.dialog.selectFile()
      if (picked) patchLocal({ licensePath: picked })
    } finally {
      setBrowseBusy(null)
    }
  }
  const browseIcon = async (): Promise<void> => {
    setBrowseBusy('icon')
    try {
      const picked = await window.nodeTerminal.dialog.selectFile()
      if (picked) patchLocal({ iconPath: picked })
    } finally {
      setBrowseBusy(null)
    }
  }

  const preview = useMemo(() => renderNsisPreview(spec, local), [spec, local])
  const complete = nsisSpecIsComplete(spec, local)

  return (
    <div
      className={`term-node nsis-node${selected ? ' selected' : ''}`}
      style={{ borderTopColor: data.color }}
    >
      <NodeResizer minWidth={380} minHeight={340} isVisible={selected} color={data.color} />

      <div
        className={`term-node__header ${headerFill.className}${
          headerFill.filled ? ' term-node__header--filled' : ''
        }`}
        style={headerFill.style}
      >
        <MaterialSymbol name="upload_file" />
        <EditableNodeTitle
          value={(data.title as string) ?? ''}
          onChange={(next) => updateNodeData(id, { title: next })}
          emptyLabel="Installer builder"
          title="Click to rename"
          ariaLabel="Installer builder name"
          rejectEmpty={false}
        />
        <span className="term-node__spacer" />
        <button
          className="term-node__close"
          title="Close"
          onClick={() => deleteElements({ nodes: [{ id }] })}
        >
          ×
        </button>
      </div>

      <div className="nsis-node__body nodrag nowheel">
        <label className="nsis-node__field">
          <span>App name</span>
          <Input
            value={spec.appName}
            onChange={(e) => patchSpec({ appName: e.target.value })}
            placeholder="Your App"
            aria-label="App name"
          />
        </label>

        <label className="nsis-node__field">
          <span>Version</span>
          <Input
            value={spec.version}
            onChange={(e) => patchSpec({ version: e.target.value })}
            placeholder="1.0.0"
            aria-label="Version"
          />
        </label>

        <label className="nsis-node__field">
          <span>Publisher</span>
          <Input
            value={spec.publisher}
            onChange={(e) => patchSpec({ publisher: e.target.value })}
            placeholder="Your company (optional)"
            aria-label="Publisher"
          />
        </label>

        <label className="nsis-node__field">
          <span>Output filename</span>
          <Input
            value={spec.outputFileName}
            onChange={(e) => patchSpec({ outputFileName: e.target.value })}
            placeholder={(spec.appName.trim() || 'App') + '-Setup.exe'}
            aria-label="Output filename"
          />
        </label>

        <label className="nsis-node__field">
          <span>Install to</span>
          <Select
            value={spec.installRoot}
            onChange={(e) => patchSpec({ installRoot: e.target.value as NsisSpec['installRoot'] })}
            aria-label="Install location"
          >
            {NSIS_INSTALL_ROOTS.map((root) => (
              <option key={root} value={root}>
                {NSIS_INSTALL_ROOT_LABELS[root]}
              </option>
            ))}
          </Select>
        </label>

        <label className="nsis-node__field">
          <span>Compression</span>
          <Select
            value={spec.compression}
            onChange={(e) => patchSpec({ compression: e.target.value as NsisSpec['compression'] })}
            aria-label="Compression"
          >
            {NSIS_COMPRESSIONS.map((c) => (
              <option key={c} value={c}>
                {NSIS_COMPRESSION_LABELS[c]}
              </option>
            ))}
          </Select>
        </label>

        <div className="nsis-node__row">
          <span>Install for every account (needs elevation)</span>
          <Switch
            checked={spec.perMachine}
            onChange={(v) => patchSpec({ perMachine: v })}
            ariaLabel="Install for every account"
          />
        </div>
        <div className="nsis-node__row">
          <span>Create desktop shortcut</span>
          <Switch
            checked={spec.createDesktopShortcut}
            onChange={(v) => patchSpec({ createDesktopShortcut: v })}
            ariaLabel="Create desktop shortcut"
          />
        </div>
        <div className="nsis-node__row">
          <span>Create Start Menu shortcut</span>
          <Switch
            checked={spec.createStartMenuShortcut}
            onChange={(v) => patchSpec({ createStartMenuShortcut: v })}
            ariaLabel="Create Start Menu shortcut"
          />
        </div>
        <div className="nsis-node__row">
          <span>Include an uninstaller</span>
          <Switch
            checked={spec.includeUninstaller}
            onChange={(v) => patchSpec({ includeUninstaller: v })}
            ariaLabel="Include an uninstaller"
          />
        </div>

        <div className="nsis-node__field">
          <span>License file (optional)</span>
          <div className="nsis-node__path-row">
            <Input
              value={local.licensePath ?? ''}
              onChange={(e) => patchLocal({ licensePath: e.target.value || undefined })}
              placeholder="Not set -- install skips the license page"
              aria-label="License file path"
            />
            <button
              type="button"
              className="nsis-node__browse"
              onClick={browseLicense}
              disabled={browseBusy === 'license'}
              title="Browse for a license file"
            >
              Browse…
            </button>
          </div>
        </div>

        <div className="nsis-node__field">
          <span>Icon file (optional)</span>
          <div className="nsis-node__path-row">
            <Input
              value={local.iconPath ?? ''}
              onChange={(e) => patchLocal({ iconPath: e.target.value || undefined })}
              placeholder="Not set -- uses NSIS's default icon"
              aria-label="Icon file path"
            />
            <button
              type="button"
              className="nsis-node__browse"
              onClick={browseIcon}
              disabled={browseBusy === 'icon'}
              title="Browse for a .ico file"
            >
              Browse…
            </button>
          </div>
        </div>

        <div className="nsis-node__field">
          <span>Files &amp; folders to install</span>
          <div className="nsis-node__path-row">
            <button
              type="button"
              className="nsis-node__browse"
              onClick={addSourceFolder}
              disabled={browseBusy === 'source'}
              title="Add a folder"
            >
              Add folder…
            </button>
            <button
              type="button"
              className="nsis-node__browse"
              onClick={addSourceFiles}
              disabled={browseBusy === 'source'}
              title="Add files"
            >
              Add files…
            </button>
          </div>

          {local.sourcePaths.length === 0 ? (
            <p className="nsis-node__hint">
              Nothing added yet. The preview below will show a placeholder until you add at least
              one file or folder -- the Add buttons above open a real folder/file picker.
            </p>
          ) : (
            <>
              <div className="menu-filter nsis-node__search">
                <div className="menu-filter__row">
                  <input
                    ref={inputRef}
                    className="menu-filter__input"
                    value={search.value}
                    spellCheck={false}
                    placeholder={search.mode === 'regex' ? 'Filter paths… (regex)' : 'Filter paths…'}
                    aria-label="Filter source paths"
                    onChange={(e) => search.setValue(e.target.value)}
                  />
                  <AnchoredRegexBuilder
                    search={search}
                    fieldRef={inputRef}
                    label="Regex — installer source paths"
                    zIndex={40}
                  />
                </div>
                {search.error && <div className="menu-filter__error">{search.error}</div>}
              </div>
              <ul className="nsis-node__source-list" role="list" aria-label="Source paths">
                {filteredSources.length === 0 ? (
                  <li className="nsis-node__hint">No path matches that filter.</li>
                ) : (
                  filteredSources.map((p) => (
                    <li key={p} className="nsis-node__source-row" title={p}>
                      <span className="nsis-node__source-path">{p}</span>
                      <button
                        type="button"
                        className="term-node__close"
                        title="Remove"
                        aria-label={'Remove ' + p}
                        onClick={() => removeSource(p)}
                      >
                        ×
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </div>

        <div className="nsis-node__field">
          <span>
            Preview
            {complete ? null : (
              <em className="nsis-node__incomplete"> — fill in the fields above for a full script</em>
            )}
          </span>
          <textarea
            className="nsis-node__preview"
            readOnly
            value={preview}
            aria-label="Generated NSIS script preview"
            spellCheck={false}
            wrap="off"
          />
        </div>
      </div>
    </div>
  )
}
