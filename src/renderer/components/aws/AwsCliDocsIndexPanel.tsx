import { useMemo, useRef, useState } from 'react'
import {
  awsCliHelpArgv,
  type AwsCliCommand,
  type AwsCliIndexSnapshot,
  type AwsCliService,
  type AwsCliShape
} from '@shared/aws-cli'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'

export interface AwsCliDocsIndexPanelProps {
  snapshot: AwsCliIndexSnapshot | null
  onClose?: () => void
  onRefresh?: () => void
  /** The shell owns execution. This callback is deliberately optional so the panel remains useful
   *  in offline and documentation-only surfaces without inventing an operation runner. */
  onOpenHelp?: (argv: string[]) => void
}

function statusLabel(snapshot: AwsCliIndexSnapshot): string {
  if (snapshot.state === 'error') return snapshot.error ?? 'The AWS CLI index could not be loaded.'
  if (snapshot.state === 'stale') return 'Offline or stale cache. The entries below are the last indexed model snapshot.'
  if (snapshot.completeness.state === 'complete') return 'Complete installed AWS CLI model index.'
  if (snapshot.completeness.state === 'partial') return 'Partial installed AWS CLI model index. Some model files were unavailable.'
  return 'AWS CLI model availability is unknown. This is not an empty service list.'
}

function searchText(service: AwsCliService, command?: AwsCliCommand): string {
  if (!command) return `${service.id} ${service.name} ${service.apiVersion ?? ''}`
  return [
    service.id,
    service.name,
    command.name,
    command.documentation ?? '',
    ...command.options.flatMap((option) => [option.name, option.documentation ?? '']),
    ...command.waiters.flatMap((waiter) => [waiter.name, waiter.operation]),
    command.inputShape ?? '',
    command.outputShape ?? ''
  ].join(' ')
}

function shapeByName(service: AwsCliService, name: string | null): AwsCliShape | null {
  return name ? service.shapes.find((shape) => shape.name === name) ?? null : null
}

export function AwsCliDocsIndexPanel({ snapshot, onClose, onRefresh, onOpenHelp }: AwsCliDocsIndexPanelProps): JSX.Element {
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [commandName, setCommandName] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const services = snapshot?.services ?? []
  const visibleServices = useMemo(
    () => services.filter((service) => search.test(searchText(service)) || service.commands.some((command) => search.test(searchText(service, command)))),
    [search, services]
  )
  const selectedService = services.find((service) => service.id === serviceId) ?? visibleServices[0] ?? null
  const visibleCommands = selectedService
    ? selectedService.commands.filter((command) => !search.active || search.test(searchText(selectedService, command)))
    : []
  const selectedCommand = selectedService?.commands.find((command) => command.name === commandName) ?? visibleCommands[0] ?? null
  const inputShape = selectedService && selectedCommand ? shapeByName(selectedService, selectedCommand.inputShape) : null
  const outputShape = selectedService && selectedCommand ? shapeByName(selectedService, selectedCommand.outputShape) : null

  const selectService = (service: AwsCliService): void => {
    setServiceId(service.id)
    setCommandName(service.commands[0]?.name ?? null)
  }

  const selectCommand = (command: AwsCliCommand): void => setCommandName(command.name)

  if (snapshot === null) {
    return (
      <section className="aws-cli-index" role="dialog" aria-label="AWS CLI documentation index">
        <header className="aws-cli-index__header">
          <h2>AWS CLI documentation index</h2>
          {onClose && <button type="button" onClick={onClose} aria-label="Close AWS CLI documentation index">Close</button>}
        </header>
        <p className="aws-cli-index__state" role="status">Loading the installed AWS CLI model files…</p>
      </section>
    )
  }

  return (
    <section className="aws-cli-index" role="dialog" aria-label="AWS CLI documentation index">
      <header className="aws-cli-index__header">
        <div>
          <h2>AWS CLI documentation index</h2>
          <p className="aws-cli-index__subtitle">Services, commands, options, paginators, waiters, skeletons, input shapes, and output shapes</p>
        </div>
        <div className="aws-cli-index__header-actions">
          {onRefresh && <button type="button" onClick={onRefresh}>Refresh local models</button>}
          {onClose && <button type="button" onClick={onClose} aria-label="Close AWS CLI documentation index">Close</button>}
        </div>
      </header>

      <div className="aws-cli-index__state" role="status">
        <strong>{statusLabel(snapshot)}</strong>
        <span>{snapshot.completeness.services} services, {snapshot.completeness.commands} commands, {snapshot.revision.value ? `revision ${snapshot.revision.value.slice(0, 12)}` : 'revision unknown'}</span>
        {snapshot.cache.path && <span>Cache: {snapshot.cache.state} at {snapshot.cache.path}</span>}
        {snapshot.completeness.reasons.map((reason) => <span key={reason}>{reason}</span>)}
      </div>

      <div className="aws-cli-index__search">
        <label htmlFor="aws-cli-index-search">Search services, commands, options, waiters, and shapes</label>
        <div className="aws-cli-index__search-row">
          <input
            id="aws-cli-index-search"
            ref={searchRef}
            type="search"
            value={search.value}
            spellCheck={false}
            placeholder={search.mode === 'regex' ? 'Search AWS CLI model index with regex…' : 'Search the AWS CLI model index…'}
            aria-describedby="aws-cli-index-search-note"
            onChange={(event) => search.setValue(event.target.value)}
          />
          <AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Regex builder for AWS CLI index search" />
        </div>
        <span id="aws-cli-index-search-note">Plain text is the default. Regex is optional and runs against the locally indexed model metadata.</span>
        {search.error && <span className="aws-cli-index__error" role="alert">{search.error}</span>}
      </div>

      <div className="aws-cli-index__body">
        <nav className="aws-cli-index__services" aria-label="AWS services">
          <div className="aws-cli-index__count">{visibleServices.length} of {services.length} services</div>
          {visibleServices.length === 0 && <p>No services match this search. The index remains unchanged.</p>}
          {visibleServices.map((service) => (
            <button
              key={service.id}
              type="button"
              className={service.id === selectedService?.id ? 'is-selected' : undefined}
              aria-current={service.id === selectedService?.id ? 'true' : undefined}
              onClick={() => selectService(service)}
            >
              <span>{service.id}</span>
              <small>{service.name} · {service.commands.length} commands</small>
            </button>
          ))}
        </nav>

        <div className="aws-cli-index__details">
          {!selectedService && <p className="aws-cli-index__empty">Choose an AWS service to inspect its installed model.</p>}
          {selectedService && (
            <>
              <div className="aws-cli-index__service-heading">
                <div>
                  <h3>{selectedService.name}</h3>
                  <p>{selectedService.id} · API {selectedService.apiVersion ?? 'unknown'} · {selectedService.protocol ?? 'protocol unknown'}</p>
                </div>
                <a href={selectedService.documentationUrl} target="_blank" rel="noreferrer">Official service documentation</a>
              </div>
              <div className="aws-cli-index__command-tabs" role="tablist" aria-label={`${selectedService.name} commands`}>
                {visibleCommands.slice(0, 200).map((command) => (
                  <button
                    key={command.name}
                    type="button"
                    role="tab"
                    aria-selected={command.name === selectedCommand?.name}
                    onClick={() => selectCommand(command)}
                  >
                    {command.name}
                  </button>
                ))}
              </div>
              {selectedCommand && (
                <article className="aws-cli-index__command" role="tabpanel">
                  <div className="aws-cli-index__command-heading">
                    <div>
                      <h4>{selectedCommand.name}</h4>
                      <code>{selectedCommand.cliPath}</code>
                    </div>
                    <div className="aws-cli-index__command-actions">
                      <a href={selectedCommand.documentationUrl} target="_blank" rel="noreferrer">Official command documentation</a>
                      <button type="button" onClick={() => onOpenHelp?.(awsCliHelpArgv(selectedService.cliName, selectedCommand.name))}>Open local help</button>
                    </div>
                  </div>
                  {selectedCommand.documentation && <p>{selectedCommand.documentation}</p>}
                  <div className="aws-cli-index__facts" aria-label="Command model facts">
                    <span>Input: {selectedCommand.inputShape ?? 'none reported'}</span>
                    <span>Output: {selectedCommand.outputShape ?? 'none reported'}</span>
                    <span>Options: {selectedCommand.options.length}</span>
                    <span>Paginator: {selectedCommand.paginator ? 'available' : 'not modeled'}</span>
                    <span>Waiters: {selectedCommand.waiters.length}</span>
                    <span>Skeleton: {selectedCommand.skeleton.supported ? selectedCommand.skeleton.modes.join(', ') : 'not supported'}</span>
                  </div>
                  <button type="button" className="aws-cli-index__advanced-toggle" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((open) => !open)}>
                    {showAdvanced ? 'Hide detailed model' : 'Show detailed model'}
                  </button>
                  {showAdvanced && (
                    <div className="aws-cli-index__advanced">
                      <ModelShape title="Input shape" shape={inputShape} />
                      <ModelShape title="Output shape" shape={outputShape} />
                      <section>
                        <h5>Options</h5>
                        <ul>{selectedCommand.options.map((option) => <li key={option.name}><code>{option.name}</code> <span>{option.valueKind}</span>{option.choices.length > 0 && <small> ({option.choices.join(', ')})</small>}<p>{option.documentation ?? 'No option documentation was provided by the installed model.'}</p></li>)}</ul>
                      </section>
                      <section>
                        <h5>Waiters</h5>
                        {selectedCommand.waiters.length === 0 ? <p>No waiter is modeled for this operation.</p> : <ul>{selectedCommand.waiters.map((waiter) => <li key={waiter.name}><strong>{waiter.name}</strong> for {waiter.operation}, delay {waiter.delaySeconds ?? 'unknown'} seconds, max attempts {waiter.maxAttempts ?? 'unknown'}</li>)}</ul>}
                      </section>
                    </div>
                  )}
                </article>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function ModelShape({ title, shape }: { title: string; shape: AwsCliShape | null }): JSX.Element {
  return (
    <section>
      <h5>{title}</h5>
      {!shape ? <p>No shape was reported by the installed service model.</p> : <>
        <p><code>{shape.name}</code> · {shape.type}</p>
        {shape.documentation && <p>{shape.documentation}</p>}
        {shape.members.length > 0 && <ul>{shape.members.map((member) => <li key={member.name}><code>{member.name}</code>: {member.shape ?? 'unknown'}{member.required ? ' · required' : ''}</li>)}</ul>}
        {shape.enumValues.length > 0 && <p>Allowed values: {shape.enumValues.join(', ')}</p>}
      </>}
    </section>
  )
}
