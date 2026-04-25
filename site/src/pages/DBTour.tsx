import { Database, FileSearch } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { InfoCard } from "../components/InfoCard"

export function DBTour() {
  return (
    <div>
      <PageHeader
        eyebrow="Open neuron.db, look inside"
        accent="cyan"
        title={<>A tour through <span className="gradient-text">neuron.db</span>.</>}
        lede="Most ML platforms hide their state behind APIs. ML-Labs's state is a single SQLite file in your project. Open it, run a query, see exactly what auto_train just wrote. This page walks through what each table looks like after a complete auto_train run."
      />

      <Section eyebrow="Setup" title="Open the DB.">
        <CodeBlock
          lang="bash"
          code={`# From your project directory
sqlite3 data/neuron.db

# Recommended: open read-only so you can't bork it
sqlite3 -readonly data/neuron.db

# Quality of life
.mode column
.headers on
.width 8 12 8 6 12   # adjust per query`}
        />
        <Callout kind="tip" title="Don't have sqlite3?">
          macOS: comes preinstalled. Ubuntu: <code>apt install sqlite3</code>. Windows: download
          from sqlite.org. Or use a GUI like <a href="https://sqlitebrowser.org/" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">DB Browser for SQLite</a>.
        </Callout>
      </Section>

      <Section eyebrow="Setup the example" title="Train iris first.">
        <p>
          The rest of this tour assumes you've run:
        </p>
        <CodeBlock
          lang="ts"
          code={`mcp__neuron__create_task({ id: "iris", kind: "classification", feature_shape: [4], normalize: true })
mcp__neuron__load_csv({ task_id: "iris", path: "./examples/iris.csv", label_column: "species", test_size: 0.2 })
mcp__neuron__auto_train({ task_id: "iris" })`}
        />
      </Section>

      <Section eyebrow="Stop 1" title="tasks — what problems exist.">
        <CodeBlock
          lang="sql"
          code={`SELECT * FROM tasks;`}
        />
        <CodeBlock
          lang="txt"
          title="Output"
          code={`id    kind            feature_shape  labels                              normalize  created_at
----  --------------  -------------  ----------------------------------  ---------  ----------
iris  classification  [4]            ["setosa","versicolor","virginica"] 1          1714000000`}
        />
        <p>
          One row, one task. <code>labels</code> is a JSON array — written by{" "}
          <code>train</code> after it sees the unique label set. <code>normalize=1</code> means we
          set normalize:true at create time. <code>created_at</code> is unix seconds.
        </p>
      </Section>

      <Section eyebrow="Stop 2" title="samples — the data.">
        <CodeBlock
          lang="sql"
          code={`-- How many in each split?
SELECT split, COUNT(*) AS n FROM samples WHERE task_id = 'iris' GROUP BY split;

-- A few rows
SELECT id, label, split, json_array_length(features) AS d
FROM samples WHERE task_id = 'iris' LIMIT 5;`}
        />
        <CodeBlock
          lang="txt"
          title="Output"
          code={`split  n
-----  ---
test   30
train  120

id  label    split  d
--  -------  -----  -
1   setosa   train  4
2   setosa   train  4
3   setosa   test   4
...`}
        />
        <p>
          150 rows total, 80/20 split, 4 features each. <code>features</code> is a JSON array of
          numbers — peek with <code>json_extract</code>:
        </p>
        <CodeBlock
          lang="sql"
          code={`SELECT id, label,
       json_extract(features, '$[0]') AS f0,
       json_extract(features, '$[1]') AS f1
FROM samples WHERE task_id = 'iris' AND split = 'train' LIMIT 3;
-- 1 | setosa | 5.1 | 3.5
-- 2 | setosa | 4.9 | 3.0
-- 3 | setosa | 4.7 | 3.2`}
        />
      </Section>

      <Section eyebrow="Stop 3" title="runs — every training attempt.">
        <CodeBlock
          lang="sql"
          code={`SELECT id, task_id, status, accuracy, val_accuracy, started_at, finished_at
FROM runs WHERE task_id = 'iris' ORDER BY id;`}
        />
        <CodeBlock
          lang="txt"
          title="Output (typical)"
          code={`id  task_id  status     accuracy  val_accuracy  started_at  finished_at
--  -------  ---------  --------  ------------  ----------  -----------
1   iris     completed  0.967     0.967         1714000123  1714000125
2   iris     completed  0.975     0.967         1714000125  1714000128
3   iris     completed  0.983     1.000         1714000128  1714000132
4   iris     completed  0.967     0.933         1714000132  1714000136
5   iris     completed  0.992     1.000         1714000136  1714000139
6   iris     completed  0.975     0.967         1714000139  1714000142`}
        />
        <p>
          6 runs from 2 waves of 3 configs. Note <code>val_accuracy</code> populated for every one
          (v1.10.0+). Run 5 has the best score — <code>val_accuracy=1.0</code>, no overfit gap.
        </p>
        <CodeBlock
          lang="sql"
          title="Look at the winner's config"
          code={`SELECT json_extract(hyperparams, '$') FROM runs WHERE id = 5;
-- {"lr":0.005,"epochs":500,"head_arch":[4,32,3],"optimizer":"sgd","loss":"cross_entropy",...}`}
        />
        <CodeBlock
          lang="sql"
          title="Loss curve as numbers"
          code={`SELECT json_extract(loss_history, '$[0]')   AS first_loss,
       json_extract(loss_history, '$[#-1]') AS last_loss,
       json_array_length(loss_history)      AS n_points
FROM runs WHERE id = 5;
-- first_loss: 1.0986, last_loss: 0.0234, n_points: 50`}
        />
      </Section>

      <Section eyebrow="Stop 4" title="models — the active model.">
        <CodeBlock
          lang="sql"
          code={`SELECT * FROM models;`}
        />
        <CodeBlock
          lang="txt"
          title="Output"
          code={`task_id  run_id  promoted_at
-------  ------  -----------
iris     5       1714000139`}
        />
        <p>
          Single row. Points to run 5 — the winner. From now on, every <code>predict</code> call on
          iris uses run 5's weights. To roll back: <code>UPDATE models SET run_id = 3 WHERE task_id =
          'iris'</code>.
        </p>
      </Section>

      <Section eyebrow="Stop 5" title="auto_runs — the controller's narration.">
        <CodeBlock
          lang="sql"
          code={`SELECT id, task_id, status, waves_used, winner_run_id, final_accuracy
FROM auto_runs WHERE task_id = 'iris';`}
        />
        <CodeBlock
          lang="txt"
          title="Output"
          code={`id  task_id  status     waves_used  winner_run_id  final_accuracy
--  -------  ---------  ----------  -------------  --------------
1   iris     completed  2           5              1.0`}
        />
        <CodeBlock
          lang="sql"
          title="The decision log — controller's reasoning"
          code={`SELECT json_extract(decision_log, '$') FROM auto_runs WHERE id = 1;`}
        />
        <CodeBlock
          lang="json"
          title="(formatted for readability)"
          code={`[
  { "stage": "inspect",         "note": "N=150 K=3 D=4 imbalance=1.0" },
  { "stage": "warm_start",      "note": "no prior patterns for fingerprint classification|k3|d_xs|s|bal" },
  { "stage": "sweep_wave_1_plan", "note": "seed config: lr=0.005, epochs=500" },
  { "stage": "sweep_wave_1_exec", "note": "starting 3 configs (mode=sub_agents, budget=safe)" },
  { "stage": "sweep_wave_1_done", "note": "best accuracy=0.983 (3 completed, 0 failed)" },
  { "stage": "sweep_wave_2_plan", "note": "refine: still_improving, narrowing lr ±25%" },
  { "stage": "sweep_wave_2_exec", "note": "starting 3 configs (mode=sub_agents)" },
  { "stage": "sweep_wave_2_done", "note": "best accuracy=0.992 (3 completed)" },
  { "stage": "target_reached",   "note": "accuracy=0.992 ≥ 0.9" },
  { "stage": "winner_selection", "note": "run 5 score=1.000 (raw accuracy=0.992, overfit=false)" },
  { "stage": "promote",          "note": "registered run 5 as active model" },
  { "stage": "calibrate",        "note": "T=1.08, ECE 0.042 → 0.019" },
  { "stage": "pattern_saved",    "note": "fingerprint=classification|k3|d_xs|s|bal" }
]`}
        />
        <Callout kind="learn" title="This is the &quot;why&quot;">
          Every decision the controller made — what it considered, what it tried, what it picked,
          why — lives in this JSON blob. The dashboard renders it as a timeline. You can read it raw
          right here, no special tooling.
        </Callout>
      </Section>

      <Section eyebrow="Stop 6" title="auto_patterns — the cross-task memory.">
        <CodeBlock
          lang="sql"
          code={`SELECT id, task_fingerprint, json_extract(best_config, '$.lr') AS lr,
       json_extract(best_config, '$.optimizer') AS opt,
       best_metric, metric_name
FROM auto_patterns;`}
        />
        <CodeBlock
          lang="txt"
          title="Output"
          code={`id  task_fingerprint                          lr     opt  best_metric  metric_name
--  ----------------------------------------  -----  ---  -----------  -----------
1   classification|k3|d_xs|s|bal              0.005  sgd  1.0          accuracy`}
        />
        <p>
          One pattern saved. Next time you train any classification task with k=3, D&lt;5, N&lt;200,
          and balanced classes, auto_train will warm-start from this config. Build up over time.
        </p>
      </Section>

      <Section eyebrow="Stop 7" title="events — the live narration.">
        <CodeBlock
          lang="sql"
          code={`-- Last 20 events for this task
SELECT
  datetime(ts/1000, 'unixepoch') AS time,
  kind,
  task_id,
  run_id
FROM events
WHERE task_id = 'iris'
ORDER BY ts DESC LIMIT 20;`}
        />
        <CodeBlock
          lang="txt"
          title="Output"
          code={`time                 kind                  task_id  run_id
-------------------  --------------------  -------  ------
2026-04-25 10:02:19  model_registered      iris     5
2026-04-25 10:02:19  auto_completed        iris     NULL
2026-04-25 10:02:19  calibrated            iris     5
2026-04-25 10:02:18  run_completed         iris     6
2026-04-25 10:02:18  auto_wave_completed   iris     NULL
2026-04-25 10:02:15  run_completed         iris     5
2026-04-25 10:02:15  run_progress          iris     5
2026-04-25 10:02:13  run_progress          iris     5
2026-04-25 10:02:11  run_started           iris     5
2026-04-25 10:02:11  auto_wave_started     iris     NULL
...`}
        />
        <p>
          ~20-50 events per auto_train. The full timeline of what happened. The dashboard's{" "}
          <code>/api/events?stream=1</code> SSE endpoint pulls new rows as they're inserted.
        </p>
      </Section>

      <Section eyebrow="Stop 8" title="predictions — what the model has been doing.">
        <CodeBlock
          lang="ts"
          title="First, run a few predictions"
          code={`mcp__neuron__predict({ task_id: "iris", features: [5.1, 3.5, 1.4, 0.2] })
mcp__neuron__predict({ task_id: "iris", features: [6.7, 3.0, 5.0, 1.7] })`}
        />
        <CodeBlock
          lang="sql"
          code={`SELECT id, run_id,
       json_extract(features, '$') AS in_features,
       json_extract(output, '$.label') AS label,
       json_extract(output, '$.confidence') AS conf
FROM predictions ORDER BY id DESC LIMIT 5;`}
        />
        <CodeBlock
          lang="txt"
          title="Output"
          code={`id  run_id  in_features                    label       conf
--  ------  -----------------------------  ----------  -----
2   5       [6.7, 3.0, 5.0, 1.7]           virginica   0.91
1   5       [5.1, 3.5, 1.4, 0.2]           setosa      0.99`}
        />
        <Callout kind="learn" title="This is what drift_check reads">
          <code>drift_check</code> compares the distribution of features in this table (the
          &ldquo;current window&rdquo;) against the distribution in <code>samples</code> (the
          training reference). Per-feature PSI + KS + verdict.
        </Callout>
      </Section>

      <Section eyebrow="Useful queries" title="A few to bookmark.">
        <CodeBlock
          lang="sql"
          title="Find the best run for a task"
          code={`SELECT id, accuracy, val_accuracy
FROM runs
WHERE task_id = 'iris' AND status = 'completed'
ORDER BY val_accuracy DESC, accuracy DESC LIMIT 1;`}
        />

        <CodeBlock
          lang="sql"
          title="Show all auto_runs by status"
          code={`SELECT status, COUNT(*) FROM auto_runs GROUP BY status;`}
        />

        <CodeBlock
          lang="sql"
          title="Find stale 'running' runs (zombie reaping)"
          code={`SELECT id, task_id, owner_pid, started_at,
       (unixepoch() - started_at) / 60 AS minutes_alive
FROM runs
WHERE status = 'running' AND (unixepoch() - started_at) > 600;`}
        />

        <CodeBlock
          lang="sql"
          title="Per-class accuracy for a run"
          code={`SELECT key AS class, value AS acc
FROM runs, json_each(runs.per_class_accuracy)
WHERE runs.id = 5;`}
        />

        <CodeBlock
          lang="sql"
          title="What tasks have I trained the most?"
          code={`SELECT task_id, COUNT(*) AS run_count
FROM runs
WHERE status = 'completed'
GROUP BY task_id ORDER BY run_count DESC;`}
        />
      </Section>

      <Section eyebrow="Reference" title="Where the schema is defined.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Database} title="Schema source" accent="cyan">
            <code>neuron/src/core/db/schema.ts</code> — every <code>CREATE TABLE</code> + auto-migration via <code>ensureColumns</code>.
            See the <a href="/db-schema" className="text-cyan-neon hover:underline">DB Schema reference</a> for
            every column.
          </InfoCard>
          <InfoCard icon={FileSearch} title="Don't break things" accent="orange">
            Tracked in <a href="/troubleshooting" className="text-orange-neon hover:underline">Troubleshooting</a>:
            don't UPDATE weights, don't DELETE running runs, don't ALTER schema by hand.
          </InfoCard>
        </div>
      </Section>
    </div>
  )
}
