import { AlertTriangle, FileSearch, ShieldAlert, Wrench } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Callout } from "../components/Callout"
import { CodeBlock } from "../components/CodeBlock"
import { AsciiDiagram } from "../components/AsciiDiagram"
import { Timeline } from "../components/Timeline"
import { InfoCard } from "../components/InfoCard"

export function Postmortems() {
  return (
    <div>
      <PageHeader
        eyebrow="What broke, and what we learned"
        accent="orange"
        title={<><span className="gradient-text">Postmortems</span>.</>}
        lede="Production systems get bugs. ML systems get especially sneaky bugs because the failure mode is often 'the model is just kinda wrong' rather than a stack trace. This page documents three real ML-Labs incidents — each one has a symptom, a hunt, a root cause, a fix, and a lasting takeaway."
      />

      <Section eyebrow="Postmortem #1" title="The Fashion-MNIST OOM (v1.7.0)">
        <div className="flex items-center gap-3 mb-4">
          <span className="chip-orange"><AlertTriangle className="w-3 h-3" /> impact: 8GB-laptop crashes</span>
          <span className="chip-cyan">date: 2026-04-21</span>
          <span className="chip-pink">fixed: v1.7.0 → v1.8.1</span>
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-orange-neon mb-2">Symptom</div>
            <p className="text-sm text-lab-text/85">
              A user ran <code>auto_train</code> on Fashion-MNIST (60k samples × 784 pixels) on an
              8GB MacBook. After ~30 seconds, Bun OOM-killed itself mid-wave. The auto_runs row
              stayed at <code>status='running'</code>. The dashboard kept showing it as in-flight.
              The user couldn't cancel it because the process was already gone.
            </p>
          </div>

          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-purple-neon mb-2">Investigation</div>
            <Timeline
              steps={[
                { step: "1", title: "Reproduce", body: <>Loaded Fashion-MNIST locally. Watched <code>top</code>. Bun ramped from 200MB → 3.6GB → killed.</>, accent: "cyan" },
                { step: "2", title: "Profile peak", body: <>Suspected the giant feature tensor. Logged tensor sizes mid-load: <code>features</code> JSON column was holding 47M numbers per sample-batch as a nested array.</>, accent: "purple" },
                { step: "3", title: "Multiplied by sub-agents", body: <>auto_train was using sub-agent sweep mode. 3 sub-agents × ~1.2GB host + 1 host = ~5GB on a sweep wave.</>, accent: "green" },
                { step: "4", title: "Triple-copy realisation", body: <>The trainer was building (a) a [N][D] nested array via featurize.map, (b) a normalised copy, (c) a flat array for rs-tensor. Three full copies in memory at peak.</>, accent: "orange" },
              ]}
            />
          </div>

          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-cyan-neon mb-2">Root cause</div>
            <AsciiDiagram title="The triple-copy problem" accent="orange">
{`        Fashion-MNIST 60k × 784 = 47M cells

   1. featurize.map        →  [N][D] nested array      ~1.2 GB
                              (one Array<Array<number>>)
   2. normalize copy        →  [N][D] another nested    ~1.2 GB
                              (functional .map)
   3. flat send to rs-tensor →  number[] of N*D         ~380 MB

   Total in JS heap: ~2.8 GB just for inputs.
   With 3 sub-agents in parallel: ~8.4 GB.
   8 GB laptop: dead.`}
            </AsciiDiagram>
            <p className="text-sm text-lab-text/85 mt-3">
              The trainer was written naively. Each transformation produced a new full copy in JS
              heap (boxed-double cost = 20 bytes per number). Plus the host process. Plus the JSON
              encode for the MCP pipe. Plus three of those running in parallel as sub-agents.
            </p>
          </div>

          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-green-neon mb-2">Fix</div>
            <p className="text-sm text-lab-text/85 mb-3">
              Three independent fixes, shipped over three minor versions:
            </p>
            <Timeline
              steps={[
                {
                  step: "v1.7.0",
                  title: "Sequential by default",
                  body: <>Stop spawning 3 sub-agents in parallel. <code>runSweepSequential</code> runs one config at a time, in-process. Sub-agents become opt-in via <code>NEURON_SWEEP_MODE=sub_agents</code>.</>,
                  accent: "cyan",
                },
                {
                  step: "v1.7.1",
                  title: "Streaming sample ingestion",
                  body: <>Replace <code>featurize.map</code> + nested arrays with a single-pass loop that fills ONE flat <code>number[]</code> of size N×D. Normalise in place. <code>~3GB → ~380MB</code> peak.</>,
                  accent: "purple",
                },
                {
                  step: "v1.8.1",
                  title: "Adaptive sweep mode",
                  body: <>auto_train consults <code>memory_budget</code>; picks sub-agents for <code>safe</code> / <code>advisory</code> levels, sequential for <code>heavy</code>. Restored the small-data parallelism while keeping the big-data safety.</>,
                  accent: "green",
                },
              ]}
            />
          </div>

          <Callout kind="learn" title="Lasting takeaway">
            JavaScript heap is not free. Boxed-double <code>number[]</code> costs ~20 bytes per
            element (vs 4 in Rust f32 or 8 in C++ double). Always think about peak memory =
            (running copies) × (rows) × (cols) × (~20 bytes). When that exceeds available RAM /
            workers, you have a problem. Stream-fill flat arrays. The memory_budget guardrail in
            v1.8.0 makes this <em>visible</em> to Claude before training starts.
          </Callout>
        </div>
      </Section>

      <Section eyebrow="Postmortem #2" title="The 'memoriser wins' bug (v1.10.0)">
        <div className="flex items-center gap-3 mb-4">
          <span className="chip-orange"><AlertTriangle className="w-3 h-3" /> impact: silent — wrong winners promoted</span>
          <span className="chip-cyan">date: 2026-04-21</span>
          <span className="chip-pink">fixed: v1.10.0</span>
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-orange-neon mb-2">Symptom</div>
            <p className="text-sm text-lab-text/85">
              On Fashion-MNIST, <code>auto_train</code> finished and promoted run 6 with a
              suspicious-looking <code>accuracy=1.0</code>. Loss had only dropped to ~0.5 — never
              reached zero. The verdict said "completed: accuracy=1.0 on run 6, target reached."
              The user filed it as "accuracy=1.0 with loss plateaued at 0.5 is mathematically
              impossible — Bug D."
            </p>
          </div>

          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-purple-neon mb-2">Investigation</div>
            <Timeline
              steps={[
                { step: "1", title: "Math check on Bug D", body: <>Loss ≈ 0.5 with label_smoothing=0.1 and K=10 is the entropy floor: <code>-0.91·log(0.91) - 9·0.01·log(0.01) ≈ 0.5003</code>. So loss=0.5 with accuracy=1.0 is achievable IF the model is perfectly correct on argmax. Not actually a bug.</>, accent: "cyan" },
                { step: "2", title: "Sanity on confusion matrix", body: <>Pulled the run's confusion matrix. Perfect diagonal: 8000 correct out of 8000. Memorised the entire training set.</>, accent: "purple" },
                { step: "3", title: "But where's val_accuracy?", body: <>The run's <code>val_accuracy</code> was NULL. Yet the held-out test split existed (10k test samples in the DB).</>, accent: "orange" },
                { step: "4", title: "Trace the train path", body: <>Grep'd the train pipeline. Found two paths: <code>api/trainBg.ts</code> (HTTP) DOES run held-out eval. <code>tools/train.ts</code> (MCP — used by sub-agent sweeps) DOES NOT.</>, accent: "pink" },
                { step: "5", title: "The chain of fallbacks", body: <>Sub-agent runs returned with val_accuracy=NULL. <code>scoreClassification</code> falls back to <code>accuracy</code>. So the most-overfit run wins.</>, accent: "green" },
              ]}
            />
          </div>

          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-cyan-neon mb-2">Root cause</div>
            <p className="text-sm text-lab-text/85 mb-3">
              The MCP <code>train</code> tool — used by every sub-agent sweep — never ran
              evaluation on the held-out test split. Only the HTTP path did. Two parallel
              code paths had drifted. The sub-agent path predated the val_accuracy column.
              No one had wired it up when the column was added.
            </p>
            <CodeBlock
              lang="ts"
              title="The bug, in essence"
              code={`// api/trainBg.ts — populates val_accuracy
const valAccuracy = await evalValAccuracy(...)
finalizeRun(runId, { ...metrics, valAccuracy })

// tools/train.ts — does not!
finalizeRun(runId, { ...metrics })   // valAccuracy=null forever`}
            />
          </div>

          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-green-neon mb-2">Fix</div>
            <p className="text-sm text-lab-text/85">
              Factor the held-out evaluation into a shared helper{" "}
              <code>evalValAccuracy()</code> in <code>core/train.ts</code>. Wire it into both paths.
              Refactor <code>api/trainBg.ts</code>'s inline duplicate to call the shared helper too.
              Both paths now populate val_accuracy identically.
            </p>
          </div>

          <Callout kind="learn" title="Lasting takeaway">
            <strong>Two paths is one path too many.</strong> Whenever the same logic lives in two
            files, they drift — silently, often by months, often without test coverage to catch it.
            ML systems are especially vulnerable because the failure mode is "wrong number" not
            "stack trace." The architectural lesson: extract <em>any</em> non-trivial logic into a
            single helper used by all call sites. The process lesson: when adding a new column to a
            table, grep every code path that writes to that table, not just the one in front of you.
          </Callout>
        </div>
      </Section>

      <Section eyebrow="Postmortem #3" title="The orphan-run zombies (v1.10.0 Bug B)">
        <div className="flex items-center gap-3 mb-4">
          <span className="chip-orange"><AlertTriangle className="w-3 h-3" /> impact: ghost rows in dashboard</span>
          <span className="chip-cyan">date: 2026-04-21</span>
          <span className="chip-pink">fixed: v1.10.0</span>
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-orange-neon mb-2">Symptom</div>
            <p className="text-sm text-lab-text/85">
              auto_train was cancelled mid-wave (budget timer fired). The auto_run was correctly
              marked as <code>budget_exceeded</code>. But the runs that were started by that
              wave's sub-agents were left in <code>status='running'</code> forever. The dashboard
              showed 3 ghost runs that would never complete, with steadily-rising "elapsed" timers.
            </p>
          </div>

          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-purple-neon mb-2">Investigation</div>
            <Timeline
              steps={[
                { step: "1", title: "Reproduce", body: <>Set <code>budget_s=10</code> on a heavy task. Watched. Auto-run hits budget, marked budget_exceeded. Three runs from the wave still showed running.</>, accent: "cyan" },
                { step: "2", title: "Read the controller exit code", body: <>The reaper at exit only iterated <code>registryEntry.childRunIds</code>. That set is populated from sub-agent results that come BACK to the orchestrator. Aborted sub-agents never get back.</>, accent: "purple" },
                { step: "3", title: "Confirm via DB", body: <>SELECT id, status FROM runs WHERE task_id = 'X' AND started_at &gt;= auto_run.started_at AND status = 'running' returned 3 rows. They had been inserted but never updated.</>, accent: "orange" },
              ]}
            />
          </div>

          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-cyan-neon mb-2">Root cause</div>
            <AsciiDiagram title="Why the registry missed them" accent="purple">
{`   timeline of a 10s-budget run:

   t=0  controller spawns sub-agents
        sub-agent 1: starts training, inserts row id=42 (status=running)
        sub-agent 2: starts training, inserts row id=43 (status=running)
        sub-agent 3: starts training, inserts row id=44 (status=running)

   t=11 budget timer fires → AbortController.abort()
        controller exits
        REAPER ITERATES registryEntry.childRunIds → empty set
        because no sub-agent had returned its result yet

   sub-agents 1, 2, 3 are killed by the abort, but their row update
   never happens. Rows 42, 43, 44 stay running forever.`}
            </AsciiDiagram>
          </div>

          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-green-neon mb-2">Fix</div>
            <p className="text-sm text-lab-text/85 mb-3">
              At controller exit, union the in-process registry's child set with a SQL scan:{" "}
              <code>SELECT id FROM runs WHERE task_id = ? AND status IN ('running', 'pending') AND
              started_at &gt;= controller_t0</code>. Force-cancel everything in the union. Runs on
              every terminal exit path (<code>completed</code>, <code>cancelled</code>,{" "}
              <code>budget_exceeded</code>, <code>failed</code>, <code>no_improvement</code>) because
              sub-agent processes occasionally outlive the abort by a few seconds.
            </p>
            <CodeBlock
              lang="ts"
              title="The fix in essence"
              code={`// Before: only the registry
const ids = registryEntry.childRunIds   // empty when sub-agent didn't return

// After: registry ∪ DB scan since t0
const ids = new Set<number>(registryEntry.childRunIds)
for (const r of listRunningRunsForTaskSince(taskId, t0_unix)) {
  ids.add(r.id)
}
for (const childId of ids) {
  forceCancelRun(childId, "cancelled")
}`}
            />
          </div>

          <Callout kind="learn" title="Lasting takeaway">
            <strong>The DB is the source of truth, not the in-process registry.</strong>{" "}
            In-process state is faster but lossy — anything that depends on it for correctness needs
            a DB-backed crosscheck. The fix unions the optimistic in-memory tracking with an
            authoritative DB query. Belt + suspenders. Same pattern applies anywhere we have
            both — registry for child-process tracking, decision_log for narrative state, etc.
          </Callout>
        </div>
      </Section>

      <Section eyebrow="What good postmortems do" title="The pattern.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={FileSearch} title="They name the symptom precisely" accent="cyan">
            Not "training broke" — &ldquo;auto_train returned accuracy=1.0 with loss plateaued at
            0.5.&rdquo; The precise statement is half the value.
          </InfoCard>
          <InfoCard icon={ShieldAlert} title="They explain the why" accent="orange">
            "Two code paths drifted because val_accuracy was added to one but not the other" is the
            useful sentence. It generalises.
          </InfoCard>
          <InfoCard icon={Wrench} title="They name the lasting fix" accent="green">
            Not just &ldquo;we patched it,&rdquo; but &ldquo;we extracted a shared helper to prevent
            future drift.&rdquo; Future-you doesn't have to rediscover it.
          </InfoCard>
          <InfoCard icon={AlertTriangle} title="They include the takeaway" accent="purple">
            One sentence that you'd say to a junior: &ldquo;Two implementations is one too many.&rdquo;
            That sentence is what survives this incident.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="When to write one" title="The bar.">
        <p>
          Not every bug becomes a postmortem. The bar:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>The fix is more interesting than the bug.</li>
          <li>The bug shape will recur somewhere else if you don't internalise the lesson.</li>
          <li>A future you would benefit from reading the explanation again.</li>
        </ul>
        <Callout kind="tip">
          Short ones &lt; 200 words still beat &lt;none&gt;. The format is forgiving — a few
          paragraphs about a tricky bug is more durable knowledge than a clever commit message.
        </Callout>
      </Section>
    </div>
  )
}
