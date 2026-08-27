import { useEffect, useMemo, useRef, useState } from 'react'
import type { CdkDiffResult, CdkProjectFileSummary, CdkSynthesisResult, CdkTrustReview } from '@shared/cdk'
import { AnchoredRegexBuilder } from '../../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../../lib/regex/useRegexSearchField'
import { openDestructiveGate } from '../../../state/destructiveGate'
import { useI18n } from '../../../lib/i18n'
import { Button } from '../../../ui/Button'
import { Input } from '../../../ui/Input'

function requestId(): string {
  return `cdk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function fileSummary(file: CdkProjectFileSummary): string {
  return `${file.name} · ${file.kind} · ${file.bytes.toLocaleString()} bytes`
}

/**
 * Guided local CDK workflow. The folder is selected through the native picker, project code is
 * not executed until the trust notice is approved, and deployment requires a fresh reviewed diff.
 * The stack filter is local and owns its own anchored full regex builder.
 */
export function CdkManagerPanel(): React.JSX.Element {
  const { ts } = useI18n()
  const copy = (key: string, fallback: string): string => ts(`cdk.${key}`, fallback)
  const [projectPath, setProjectPath] = useState('')
  const [status, setStatus] = useState<Awaited<ReturnType<typeof window.nodeTerminal.cdk.status>> | null>(null)
  const [review, setReview] = useState<CdkTrustReview | null>(null)
  const [synthesis, setSynthesis] = useState<CdkSynthesisResult | null>(null)
  const [diff, setDiff] = useState<CdkDiffResult | null>(null)
  const [selectedStacks, setSelectedStacks] = useState<string[]>([])
  const [trustAcknowledged, setTrustAcknowledged] = useState(false)
  const [diffAcknowledged, setDiffAcknowledged] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const stackSearch = useRegexSearchField()
  const stackSearchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.nodeTerminal.cdk.status().then(setStatus).catch((cause) => {
      setStatus({ available: false, version: null, executable: null, reason: cause instanceof Error ? cause.message : String(cause) })
    })
  }, [])

  const stacks = synthesis?.stackNames ?? []
  const visibleStacks = useMemo(
    () => stacks.filter((stack) => stackSearch.test(stack)),
    [stacks, stackSearch]
  )
  const selected = selectedStacks.length === 0 ? stacks : selectedStacks

  const run = async <T,>(label: string, action: () => Promise<T>, onSuccess: (value: T) => void, operationId?: string): Promise<void> => {
    setBusy(label)
    setActiveRequestId(operationId ?? null)
    setError('')
    setNotice('')
    try {
      onSuccess(await action())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
      setActiveRequestId(null)
    }
  }

  const chooseFolder = async (): Promise<void> => {
    setError('')
    const folder = await window.nodeTerminal.dialog.selectFolder().catch(() => null)
    if (!folder) return
    setProjectPath(folder)
    setReview(null)
    setSynthesis(null)
    setDiff(null)
    setSelectedStacks([])
    setTrustAcknowledged(false)
    setDiffAcknowledged(false)
    setNotice(copy('folderChosen', 'Folder selected. Inspect it before allowing CDK code to run.'))
  }

  const inspect = (): void => {
    void run('inspect', () => window.nodeTerminal.cdk.inspectProject({ projectPath }), (value) => {
      setReview(value)
      setSynthesis(null)
      setDiff(null)
      setTrustAcknowledged(false)
      setDiffAcknowledged(false)
      setNotice(copy('inspectionReady', 'Trust review is ready. Read the app command and warnings before approving.'))
    })
  }

  const approve = (): void => {
    if (!review || !trustAcknowledged) return
    void run('trust', () => window.nodeTerminal.cdk.approveTrust({ projectPath, reviewToken: review.reviewToken }), (value) => {
      setReview({ ...review, ...value, files: review.files, contextKeys: review.contextKeys, warnings: review.warnings, reviewed: true })
      setNotice(copy('trustApproved', 'Trust approved for this project in this app session.'))
    })
  }

  const synth = (): void => {
    if (!review?.reviewed) return
    const id = requestId()
    void run('synth', () => window.nodeTerminal.cdk.synth({ projectPath, reviewToken: review.reviewToken, requestId: id, stackNames: selected }), (value) => {
      setSynthesis(value)
      setDiff(null)
      setSelectedStacks(value.stackNames)
      setDiffAcknowledged(false)
      setNotice(copy('synthComplete', 'Synthesis completed. Review the generated stack list before opening a diff.'))
    }, id)
  }

  const inspectDiff = (): void => {
    if (!review?.reviewed || !synthesis) return
    const id = requestId()
    void run('diff', () => window.nodeTerminal.cdk.diff({ projectPath, reviewToken: review.reviewToken, requestId: id, stackNames: selected }), (value) => {
      setDiff(value)
      setDiffAcknowledged(false)
      setNotice(copy('diffReady', 'Diff ready. Read the complete change list before reviewing deployment.'))
    }, id)
  }

  const deploy = (): void => {
    if (!review?.reviewed || !diff || !diffAcknowledged) return
    const payload = {
      projectPath,
      reviewToken: review.reviewToken,
      diffReviewToken: diff.reviewToken,
      requestId: requestId(),
      stackNames: diff.stackNames
    }
    const perform = (): void => {
      void run('deploy', () => window.nodeTerminal.cdk.deploy(payload), (value) => {
        setNotice(copy('deployComplete', 'Deployment completed. The CDK CLI returned an operation result.'))
        setDiff(null)
        setDiffAcknowledged(false)
        setNotice(`${copy('deployComplete', 'Deployment completed.')} ${value.stackNames.join(', ') || copy('allStacks', 'all synthesized stacks')}`)
      }, payload.requestId)
    }
    if (diff.requiresConfirmation) {
      const opened = openDestructiveGate({
        title: copy('deployTitle', 'Review infrastructure deployment'),
        description: copy('deployDescription', 'This deployment includes removal or replacement changes. Both confirmation keys and the full slider are required before CDK runs.'),
        affected: diff.changes.map((change) => `${change.action} ${change.logicalId} (${change.resourceType})`).slice(0, 80),
        confirmLabel: copy('deployConfirm', 'Deploy reviewed changes'),
        onConfirm: perform
      })
      if (!opened) setError(copy('confirmationBusy', 'Another confirmation is open. Finish or cancel it before deploying.'))
      return
    }
    perform()
  }

  const cancel = (): void => {
    if (!activeRequestId) return
    void window.nodeTerminal.cdk.cancel(activeRequestId).catch(() => false)
  }

  return (
    <section className="cdk-manager nodrag" aria-label={copy('title', 'AWS CDK manager')}>
      <header className="cdk-manager__header">
        <div>
          <h3>{copy('title', 'AWS CDK manager')}</h3>
          <p>{copy('description', 'Select a local CDK project, review its trust boundary, synthesize, inspect the diff, then deploy only after review.')}</p>
        </div>
        <span className={`cdk-manager__availability${status?.available ? ' is-ready' : ''}`} role="status">
          {status?.available ? `${copy('available', 'CDK ready')} · ${status.version ?? copy('versionUnknown', 'version unavailable')}` : (status?.reason ?? copy('checking', 'Checking CDK availability…'))}
        </span>
      </header>

      <div className="cdk-manager__folder">
        <label htmlFor="cdk-project-folder">{copy('projectFolder', 'CDK project folder')}</label>
        <div className="cdk-manager__folder-row">
          <Input id="cdk-project-folder" value={projectPath} readOnly placeholder={copy('folderEmpty', 'Choose the folder containing cdk.json')} aria-describedby="cdk-project-folder-help" />
          <Button onClick={() => void chooseFolder()}>{copy('browse', 'Browse…')}</Button>
          <Button disabled={!projectPath || !!busy} onClick={inspect}>{busy === 'inspect' ? copy('inspecting', 'Inspecting…') : copy('inspect', 'Inspect project')}</Button>
        </div>
        <p id="cdk-project-folder-help">{copy('folderHelp', 'The folder path stays local and is never written to the portable project projection.')}</p>
      </div>

      {review ? <section className="cdk-manager__card" aria-labelledby="cdk-trust-heading">
        <h4 id="cdk-trust-heading">{copy('trustHeading', 'Trust review')}</h4>
        <p>{copy('trustIntro', 'CDK will execute the app command from this folder when you synthesize or deploy. Review these files and warnings first.')}</p>
        <dl className="cdk-manager__facts">
          <dt>{copy('appCommand', 'App command')}</dt><dd><code>{review.appCommand || copy('missingApp', 'Not declared')}</code></dd>
          <dt>{copy('configPath', 'Config')}</dt><dd><code>{review.cdkConfigPath}</code></dd>
          <dt>{copy('contextKeys', 'Context keys')}</dt><dd>{review.contextKeys.length ? review.contextKeys.join(', ') : copy('none', 'None detected')}</dd>
        </dl>
        <ul className="cdk-manager__file-list" aria-label={copy('files', 'Project files reviewed')}>
          {review.files.map((file) => <li key={file.name}>{fileSummary(file)}</li>)}
        </ul>
        <ul className="cdk-manager__warnings" aria-label={copy('warnings', 'Trust warnings')}>
          {review.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
        </ul>
        {!review.reviewed ? <>
          <label className="cdk-manager__check"><input type="checkbox" checked={trustAcknowledged} onChange={(event) => setTrustAcknowledged(event.target.checked)} /> {copy('trustAck', 'I reviewed the app command and allow this local project code to run.')}</label>
          <Button disabled={!trustAcknowledged || !!busy} onClick={approve}>{busy === 'trust' ? copy('approving', 'Approving…') : copy('approve', 'Approve trust review')}</Button>
        </> : <p className="cdk-manager__approved" role="status">{copy('approved', 'Trust approved for this app session.')}</p>}
      </section> : null}

      {review?.reviewed ? <section className="cdk-manager__card" aria-labelledby="cdk-synth-heading">
        <div className="cdk-manager__card-header"><h4 id="cdk-synth-heading">{copy('synthesisHeading', 'Synth and stack selection')}</h4><Button disabled={!!busy} onClick={synth}>{busy === 'synth' ? copy('synthesizing', 'Synthesizing…') : copy('synth', 'Synth')}</Button></div>
        <p>{copy('synthesisHelp', 'Synth runs the reviewed project app and keeps generated templates in a temporary local folder.')}</p>
        {synthesis ? <>
          <div className="cdk-manager__search-row">
            <Input ref={stackSearchRef} type="search" value={stackSearch.value} onChange={(event) => stackSearch.setValue(event.target.value)} placeholder={copy('searchStacks', 'Search synthesized stacks')} aria-label={copy('searchStacksAria', 'Search synthesized stacks')} />
            <AnchoredRegexBuilder search={stackSearch} fieldRef={stackSearchRef} label={copy('regexStacks', 'Regex builder for synthesized stack search')} />
          </div>
          {stackSearch.error ? <p className="cdk-manager__error" role="alert">{stackSearch.error}</p> : null}
          <p className="cdk-manager__count" role="status">{visibleStacks.length} {copy('stacksShown', 'stacks shown')} · {selectedStacks.length ? `${selectedStacks.length} ${copy('selected', 'selected')}` : copy('allSelected', 'all synthesized stacks selected')}</p>
          <div className="cdk-manager__stacks" role="group" aria-label={copy('stackList', 'Synthesized stacks')}>
            {visibleStacks.map((stack) => <label key={stack}><input type="checkbox" checked={selectedStacks.length === 0 || selectedStacks.includes(stack)} onChange={(event) => setSelectedStacks((current) => {
              const next = current.length === 0 ? stacks : current
              return event.target.checked ? [...new Set([...next, stack])] : next.filter((item) => item !== stack)
            })} /> {stack}</label>)}
          </div>
          <Button disabled={!stacks.length || !!busy} onClick={inspectDiff}>{busy === 'diff' ? copy('diffing', 'Opening diff…') : copy('openDiff', 'Open reviewed diff')}</Button>
        </> : <p className="cdk-manager__empty">{copy('synthEmpty', 'No synthesis has been run yet.')}</p>}
      </section> : null}

      {diff ? <section className="cdk-manager__card" aria-labelledby="cdk-diff-heading">
        <div className="cdk-manager__card-header"><h4 id="cdk-diff-heading">{copy('diffHeading', 'Infrastructure diff review')}</h4><span>{diff.requiresConfirmation ? copy('destructiveChanges', 'Removal or replacement changes found') : copy('noDestructiveChanges', 'No removal or replacement parsed')}</span></div>
        <p>{copy('diffHelp', 'Read the complete CDK diff. Deployment is unavailable until you acknowledge this exact review.')}</p>
        <pre className="cdk-manager__output" tabIndex={0} aria-label={copy('diffOutput', 'CDK diff output')}>{diff.text || copy('emptyDiff', 'CDK returned an empty diff.')}</pre>
        <label className="cdk-manager__check"><input type="checkbox" checked={diffAcknowledged} onChange={(event) => setDiffAcknowledged(event.target.checked)} /> {copy('diffAck', 'I reviewed this exact diff and its affected stacks.')}</label>
        <Button disabled={!diffAcknowledged || !!busy} onClick={deploy}>{busy === 'deploy' ? copy('deploying', 'Deploying…') : copy('deploy', 'Deploy reviewed diff')}</Button>
      </section> : null}

      {busy ? <div className="cdk-manager__progress" role="status" aria-live="polite"><span>{copy('progress', 'CDK operation in progress')}</span><progress /> <Button onClick={cancel}>{copy('cancel', 'Cancel')}</Button></div> : null}
      {notice ? <p className="cdk-manager__notice" role="status">{notice}</p> : null}
      {error ? <p className="cdk-manager__error" role="alert">{error}</p> : null}
      <p className="cdk-manager__privacy">{copy('privacy', 'Portable intent stores only safe app and stack intent. Credentials, provider sessions, local paths, generated templates, and process state stay local.')}</p>
    </section>
  )
}
