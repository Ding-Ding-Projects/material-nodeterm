import { NodeResizer, useReactFlow, type NodeProps } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CanvasNode } from "../state/workspace";
import { useProjects } from "../state/projects";
import { useNotifications } from "../state/notifications";
import { useI18n } from "../lib/i18n";
import { useVocabularyMapper } from "../lib/personalVocabulary/useVocabularyText";
import { EditableNodeTitle } from "../components/EditableNodeTitle";
import {
  canonicalTriggerSpec,
  sanitizeTriggerSpec,
  type TriggerRunReceipt,
  type TriggerSchedule,
  type TriggerSpec,
  type TriggerStatus,
} from "@shared/trigger";
import { Button, TextArea } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'

const LOCAL_TIME_ZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function defaultSpec(data: CanvasNode["data"]): TriggerSpec {
  const parsed = sanitizeTriggerSpec(data.trigger);
  return (
    parsed ?? {
      schedule: { kind: "interval", everyMinutes: 60 },
      payload: "",
      target: "",
    }
  );
}

function localInputValue(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function receiptLabel(receipt: TriggerRunReceipt): string {
  return `${receipt.outcome} · ${new Date(receipt.at).toLocaleString()}`;
}

function compileRegex(pattern: string, flags: string): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, flags.replace(/[^dgimsuvy]/g, ""));
  } catch {
    return null;
  }
}

/**
 * A complete, disarmed-by-default trigger editor. Definitions are shared canvas data, while arm
 * consent and run history come from the host bridge. The review step is deliberately explicit for
 * both arming and manual execution so editing a text area can never launch a stale payload.
 */
export default function TriggerNode({
  id,
  data,
  selected,
}: NodeProps<CanvasNode>) {
  const { deleteElements, updateNodeData } = useReactFlow();
  const vocab = useVocabularyMapper();
  const { ts } = useI18n();
  const copy = useCallback(
    (key: string, fallback: string) => vocab(ts(key, fallback)),
    [ts, vocab],
  );
  const activeProjectId = useProjects((state) => state.activeProjectId);
  const projects = useProjects((state) => state.projects);
  const api = window.nodeTerminal.trigger;
  const spec = defaultSpec(data);
  const [status, setStatus] = useState<TriggerStatus>({
    armed: false,
    changedSinceArmed: false,
    inFlight: false,
  });
  const [history, setHistory] = useState<TriggerRunReceipt[]>([]);
  const [targetSearch, setTargetSearch] = useState("");
  const [regexOpen, setRegexOpen] = useState(false);
  const [regexPattern, setRegexPattern] = useState("");
  const [regexFlags, setRegexFlags] = useState("i");
  const [review, setReview] = useState<"arm" | "run" | null>(null);

  const project = projects.find(
    (candidate) => candidate.id === activeProjectId,
  );
  const targets = useMemo(() => {
    const query = targetSearch.trim().toLocaleLowerCase();
    let regex: RegExp | null = null;
    if (regexOpen && regexPattern)
      regex = compileRegex(regexPattern, regexFlags);
    return (project?.nodes ?? []).filter((node) => {
      if (
        node.id === id ||
        (node.kind !== "terminal" && node.kind !== "subagent")
      )
        return false;
      const text = `${node.title} ${node.id} ${node.agentId ?? ""}`;
      if (regex) {
        regex.lastIndex = 0;
        return regex.test(text);
      }
      return !query || text.toLocaleLowerCase().includes(query);
    });
  }, [id, project?.nodes, regexFlags, regexOpen, regexPattern, targetSearch]);

  const patch = useCallback(
    (next: Partial<CanvasNode["data"]>) => updateNodeData(id, next),
    [id, updateNodeData],
  );
  const setSpec = useCallback(
    (next: Partial<TriggerSpec>) => {
      const candidate = { ...spec, ...next } as TriggerSpec;
      patch({ trigger: candidate });
    },
    [patch, spec],
  );
  const setSchedule = useCallback(
    (next: Partial<TriggerSchedule>) => {
      setSpec({ schedule: { ...spec.schedule, ...next } as TriggerSchedule });
    },
    [setSpec, spec.schedule],
  );

  const refresh = useCallback(async () => {
    if (!api || !activeProjectId) return;
    const [nextStatus, nextHistory] = await Promise.all([
      api
        .status(activeProjectId, id)
        .catch(() => ({
          armed: false,
          changedSinceArmed: false,
          inFlight: false,
        })),
      api.history(activeProjectId, id).catch(() => []),
    ]);
    setStatus(nextStatus);
    setHistory(nextHistory.slice(-50).reverse());
  }, [activeProjectId, api, id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!api) return;
    return api.onChanged((receipt) => {
      if (receipt.nodeId !== id) return;
      setHistory((previous) =>
        [receipt, ...previous.filter((entry) => entry.id !== receipt.id)].slice(
          0,
          50,
        ),
      );
      void refresh();
    });
  }, [api, id, refresh]);

  const validSpec = sanitizeTriggerSpec(spec);
  const invalidReason = validSpec
    ? ""
    : "Choose a target and provide a valid non-empty payload before continuing.";
  const currentTarget = project?.nodes.find((node) => node.id === spec.target);
  const selectedTargetMissing = !!spec.target && !currentTarget;
  const displayNext = status.nextOccurrenceAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: LOCAL_TIME_ZONE,
      }).format(new Date(status.nextOccurrenceAt))
    : vocab("Not scheduled");

  const arm = async () => {
    if (!api || !activeProjectId || !validSpec) return;
    const ok = await api.arm(activeProjectId, id, validSpec);
    setReview(null);
    if (!ok)
      useNotifications
        .getState()
        .push({
          kind: "error",
          title: vocab("Trigger not armed"),
          body: vocab(
            "The host rejected this trigger definition. Nothing was scheduled.",
          ),
          autoDismissMs: null,
        });
    else
      useNotifications
        .getState()
        .push({
          kind: "success",
          title: vocab("Trigger armed"),
          body: vocab(
            "Local consent recorded for this exact schedule and payload.",
          ),
          autoDismissMs: 7000,
        });
    await refresh();
  };

  const runNow = async () => {
    if (!api || !activeProjectId || !validSpec) return;
    const receipt = await api.runNow(activeProjectId, id);
    setReview(null);
    setHistory((previous) => [receipt, ...previous].slice(0, 50));
    useNotifications.getState().push({
      kind: receipt.outcome === "delivered" ? "success" : "warning",
      title: vocab("Trigger run finished"),
      body:
        receipt.outcome === "delivered"
          ? vocab("The reviewed payload was delivered.")
          : `${vocab("No payload was sent.")}: ${receipt.outcome}`,
      autoDismissMs: receipt.outcome === "delivered" ? 7000 : null,
    });
    await refresh();
  };

  const disarm = async () => {
    if (!api || !activeProjectId) return;
    await api.disarm(activeProjectId, id);
    await refresh();
  };

  return (
    <div
      className={`term-node trigger-node${selected ? " selected" : ""}`}
      style={{ borderTopColor: data.color }}
    >
      <NodeResizer
        minWidth={360}
        minHeight={380}
        isVisible={selected}
        color={data.color}
      />
      <div className="term-node__header trigger-node__header">
        <span aria-hidden="true" className="trigger-node__glyph">
          ⚡
        </span>
        <EditableNodeTitle
          value={String(data.title ?? "Trigger")}
          onChange={(title) => patch({ title })}
          emptyLabel="Trigger"
          title="Click to rename"
          ariaLabel="Trigger node name"
          rejectEmpty={false}
        />
        <span className="term-node__spacer" />
        <Button variant="outlined" size="small" vocabularyMode="factual"
          className="term-node__close"
          title={vocab("Close")}
          aria-label={vocab("Close Trigger")}
          onClick={() => deleteElements({ nodes: [{ id }] })}
        >
          ×
        </Button>
      </div>
      <div className="trigger-node__body nodrag nowheel">
        <label>
          {copy("trigger.scheduleType", "Schedule type")}
          <Select vocabularyMode="factual"
            aria-label={copy("trigger.scheduleType", "Schedule type")}
            value={spec.schedule.kind}
            onChange={(event) => {
              const kind = event.target.value as TriggerSchedule["kind"];
              if (kind === "cron")
                setSpec({ schedule: { kind, expr: "0 * * * *" } });
              else if (kind === "once")
                setSpec({
                  schedule: {
                    kind,
                    at: new Date(Date.now() + 3_600_000).toISOString(),
                  },
                });
              else setSpec({ schedule: { kind, everyMinutes: 60 } });
            }}
          >
            <option value="interval">
              {copy("trigger.interval", "Interval")}
            </option>
            <option value="cron">{copy("trigger.cron", "Cron")}</option>
            <option value="once">{copy("trigger.once", "Once")}</option>
          </Select>
        </label>
        {spec.schedule.kind === "interval" ? (
          <label>
            {copy("trigger.everyMinutes", "Every minutes")}
            <Input vocabularyMode="factual"
              type="number"
              min={1}
              max={527040}
              value={spec.schedule.everyMinutes}
              aria-label={copy("trigger.everyMinutes", "Every minutes")}
              onChange={(event) =>
                setSchedule({ everyMinutes: Number(event.target.value) })
              }
            />
          </label>
        ) : null}
        {spec.schedule.kind === "cron" ? (
          <label>
            {copy("trigger.cronExpression", "Five-field cron")}
            <Input vocabularyMode="factual"
              value={spec.schedule.expr}
              maxLength={256}
              aria-label={copy("trigger.cronExpression", "Five-field cron")}
              onChange={(event) => setSchedule({ expr: event.target.value })}
            />
            <small>{vocab("minute hour day month weekday")}</small>
          </label>
        ) : null}
        {spec.schedule.kind === "once" ? (
          <label>
            {copy("trigger.runAt", "Run at")}
            <Input vocabularyMode="factual"
              type="datetime-local"
              value={localInputValue(spec.schedule.at)}
              aria-label={copy("trigger.runAt", "Run at")}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) return;
                const date = new Date(value);
                if (Number.isFinite(date.getTime()))
                  setSchedule({ at: date.toISOString() });
              }}
            />
          </label>
        ) : null}
        <p className="trigger-node__timezone" role="status">
          {copy("trigger.timezone", "Timezone")}: {LOCAL_TIME_ZONE}
        </p>
        <label>
          {vocab("Target")}
          <Select vocabularyMode="factual"
            value={spec.target}
            aria-label={vocab("Trigger target")}
            onChange={(event) => setSpec({ target: event.target.value })}
          >
            <option value="">{vocab("Choose a target")}</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.title || target.id}
                {target.agentId ? ` · ${target.agentId}` : ""}
              </option>
            ))}
          </Select>
        </label>
        <div className="trigger-node__target-search">
          <Input vocabularyMode="factual"
            value={targetSearch}
            placeholder={vocab("Search targets")}
            aria-label={vocab("Search targets")}
            onChange={(event) => setTargetSearch(event.target.value)}
          />
          <Button variant="outlined" size="small" vocabularyMode="factual"
            type="button"
            aria-expanded={regexOpen}
            title={vocab("Open regex builder")}
            onClick={() => setRegexOpen((open) => !open)}
          >
            {" .* "}
          </Button>
        </div>
        {regexOpen ? (
          <div
            className="trigger-node__regex"
            role="dialog"
            aria-label={vocab("Target regex builder")}
          >
            <label>
              {vocab("Pattern")}
              <Input vocabularyMode="factual"
                value={regexPattern}
                onChange={(event) => setRegexPattern(event.target.value)}
              />
            </label>
            <label>
              {vocab("Flags")}
              <Input vocabularyMode="factual"
                value={regexFlags}
                onChange={(event) => setRegexFlags(event.target.value)}
              />
            </label>
            <small>
              {regexPattern && !compileRegex(regexPattern, regexFlags)
                ? vocab("Invalid regular expression")
                : vocab("Plain text is the default")}
            </small>
          </div>
        ) : null}
        <label>
          {vocab("Payload")}
          <TextArea vocabularyMode="factual"
            value={spec.payload}
            maxLength={16_384}
            rows={4}
            aria-label={vocab("Trigger payload")}
            onChange={(event) => setSpec({ payload: event.target.value })}
          />
        </label>
        <label>
          {vocab("Note")}
          <Input vocabularyMode="factual"
            value={spec.note ?? ""}
            maxLength={500}
            aria-label={vocab("Trigger note")}
            onChange={(event) =>
              setSpec({ note: event.target.value || undefined })
            }
          />
        </label>
        {invalidReason ? (
          <p className="trigger-node__error" role="alert">
            {vocab(invalidReason)}
          </p>
        ) : null}
        {selectedTargetMissing ? (
          <p className="trigger-node__error" role="alert">
            {vocab("The selected target is unavailable in this project.")}
          </p>
        ) : null}
        <p className="trigger-node__honesty">
          {vocab(
            "Scheduled delivery is local-only, requires explicit consent, and never catches up missed runs.",
          )}
        </p>
        <div className="trigger-node__status">
          <strong>{status.armed ? vocab("Armed") : vocab("Disarmed")}</strong>
          <span>
            {vocab("Next")}: {displayNext}
          </span>
          <span>{status.inFlight ? vocab("Running") : vocab("Idle")}</span>
        </div>
        <div className="trigger-node__actions">
          <Button variant="outlined" size="small" vocabularyMode="factual"
            type="button"
            disabled={!validSpec || !api}
            onClick={() => setReview("arm")}
          >
            {vocab("Arm")}
          </Button>
          <Button variant="outlined" size="small" vocabularyMode="factual"
            type="button"
            disabled={!status.armed || !api}
            onClick={() => void disarm()}
          >
            {vocab("Disarm")}
          </Button>
          <Button variant="outlined" size="small" vocabularyMode="factual"
            type="button"
            disabled={!validSpec || !api || status.inFlight}
            onClick={() => setReview("run")}
          >
            {vocab("Run now")}
          </Button>
        </div>
        <div className="trigger-node__history">
          <div className="trigger-node__history-head">
            <strong>{vocab("History")}</strong>
            <span>{history.length}</span>
          </div>
          {history.length === 0 ? (
            <p>{vocab("No trigger runs yet.")}</p>
          ) : (
            <ul>
              {history.slice(0, 8).map((receipt) => (
                <li key={receipt.id}>{receiptLabel(receipt)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {review ? (
        <div
          className="trigger-node__review"
          role="dialog"
          aria-modal="false"
          aria-label={
            review === "arm"
              ? vocab("Review trigger arm")
              : vocab("Review trigger run")
          }
        >
          <h3>
            {review === "arm"
              ? vocab("Review before arming")
              : vocab("Review before running")}
          </h3>
          <p>
            {vocab("Schedule")}: {canonicalTriggerSpec(validSpec ?? spec)}
          </p>
          <p>
            {vocab("Target")}:{" "}
            {currentTarget?.title || spec.target || vocab("Unavailable")}
          </p>
          <p>
            {vocab("Timezone")}: {LOCAL_TIME_ZONE}
          </p>
          <p>
            {vocab(
              "Local consent only. Shared project files never contain arm state.",
            )}
          </p>
          <div>
            <Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => setReview(null)}>
              {vocab("Cancel")}
            </Button>
            <Button variant="outlined" size="small" vocabularyMode="factual"
              type="button"
              disabled={!validSpec}
              onClick={() => void (review === "arm" ? arm() : runNow())}
            >
              {review === "arm" ? vocab("Confirm arm") : vocab("Confirm run")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
