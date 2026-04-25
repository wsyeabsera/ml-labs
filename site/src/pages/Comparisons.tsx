import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Callout } from "../components/Callout"
import { Table } from "../components/Table"

export function Comparisons() {
  return (
    <div>
      <PageHeader
        eyebrow="When ML-Labs fits and when it doesn't"
        accent="orange"
        title={<><span className="gradient-text">Comparisons</span>.</>}
        lede="ML-Labs is a Claude-native, local-first, MLP-only platform. That's a specific spot in the design space. This page compares it honestly to sklearn, PyTorch Lightning, and MLflow / W&B — what each one is for, where they overlap, and which to pick for which job."
      />

      <Section eyebrow="The headline" title="ML-Labs vs everything else.">
        <Table
          columns={[
            { key: "axis",    header: "Axis",                     accent: "cyan" },
            { key: "ml",      header: "ML-Labs" },
            { key: "sk",      header: "sklearn" },
            { key: "torch",   header: "PyTorch Lightning" },
            { key: "track",   header: "MLflow / W&B" },
          ]}
          rows={[
            { axis: "Primary user",       ml: "Claude (or you, via Claude)",  sk: "Python notebook user",    torch: "Python ML engineer",    track: "ML team tracking experiments" },
            { axis: "Compute",            ml: "CPU-only, local",              sk: "CPU, local",              torch: "CPU/GPU, local + cloud", track: "delegates to other tools" },
            { axis: "Models supported",   ml: "MLP only (+ small LLM)",       sk: "trees / linear / kNN / MLP / SVM", torch: "anything",         track: "—" },
            { axis: "Surface",            ml: "MCP tools",                    sk: "Python API",              torch: "Python class hierarchy",  track: "Python API + UI" },
            { axis: "Persistence",        ml: "SQLite, automatic",            sk: "pickle / joblib, manual", torch: "pickle, manual",         track: "MLflow store / cloud" },
            { axis: "Hyperparam search",  ml: "auto_train (rules + TPE + Claude)", sk: "GridSearchCV",       torch: "Optuna integration",     track: "—" },
            { axis: "Tracking",           ml: "Built-in (events, runs)",      sk: "DIY",                     torch: "DIY",                    track: "the whole point" },
            { axis: "Calibration",        ml: "calibrate built-in",           sk: "CalibratedClassifierCV",  torch: "DIY",                    track: "—" },
            { axis: "Drift",              ml: "drift_check built-in",         sk: "—",                        torch: "—",                       track: "Evidently / NannyML add-on" },
            { axis: "GPU",                ml: "no",                            sk: "no",                       torch: "yes",                    track: "—" },
            { axis: "Onboarding",         ml: "30s install + Claude session", sk: "pip install", torch: "pip install + GPU drivers", track: "account + setup" },
          ]}
        />
        <Callout kind="learn" title="The rough mapping">
          ML-Labs ≈ &ldquo;sklearn but Claude-driven, with built-in tracking and a CPU-only
          architecture cap.&rdquo;
        </Callout>
      </Section>

      <Section eyebrow="ML-Labs vs sklearn" title="The closest cousin.">
        <p>
          sklearn is the obvious baseline. Both are local, both are CPU, both target
          tabular-flavoured ML. The difference is the API surface and what's automated.
        </p>
        <Table
          columns={[
            { key: "case",   header: "Case",                                               accent: "purple" },
            { key: "ml",     header: "ML-Labs" },
            { key: "sk",     header: "sklearn" },
          ]}
          rows={[
            { case: "Quick baseline on a CSV",      ml: "/neuron-load + /neuron-auto",              sk: "RandomForestClassifier().fit(X, y) — 5 lines of Python, fewer if you skip cross-validation." },
            { case: "Hyperparameter search",        ml: "auto_train picks for you",                 sk: "GridSearchCV — manual grid setup." },
            { case: "Save and reload model",        ml: "publish_model + import_model",             sk: "joblib.dump / joblib.load — manual versioning." },
            { case: "Cross-session predict",        ml: "Lazy-restore from SQLite, automatic",      sk: "Reload pickle file, recompute fitted state." },
            { case: "Tree-based models",            ml: "Not supported — MLP only",                 sk: "RandomForest, GradientBoosting, XGBoost wrappers — often the right tool." },
            { case: "Sparse / very-high-dim data",  ml: "Not great — MLP forward pass densifies",   sk: "First-class sparse matrices in linear models." },
            { case: "Pipeline composition",         ml: "Featurize callback in neuron.config.ts",   sk: "Pipeline + ColumnTransformer — much richer." },
            { case: "Comparing 10 algorithms",      ml: "Only one (MLP)",                            sk: "Trivial — switch the import." },
          ]}
        />
        <Callout kind="warn" title="Use sklearn when">
          You want gradient-boosted trees (almost always the best non-DL choice for tabular).
          You want sparse matrices. You want the rich preprocessing pipeline. You want one of the
          15 algorithms sklearn ships that ML-Labs doesn't have.
        </Callout>
        <Callout kind="success" title="Use ML-Labs when">
          You want Claude to drive. You don't want to manage models / tracking yourself. The
          problem fits an MLP (small tabular, embedded text/image). You'd rather ask in English
          than write Python.
        </Callout>
      </Section>

      <Section eyebrow="ML-Labs vs PyTorch Lightning" title="Different leagues.">
        <p>
          PyTorch Lightning is for serious deep learning. It assumes you can write a
          <code> LightningModule</code> class, wire up data loaders, manage GPU memory, distribute
          across nodes. ML-Labs is for the opposite end of the complexity range.
        </p>
        <Table
          columns={[
            { key: "case",   header: "Case",                              accent: "purple" },
            { key: "ml",     header: "ML-Labs" },
            { key: "torch",  header: "PyTorch Lightning" },
          ]}
          rows={[
            { case: "Custom architecture",       ml: "Only MLP shapes (head_arch list)",         torch: "Anything — write nn.Module" },
            { case: "GPU training",              ml: "No",                                        torch: "Yes, multi-GPU, mixed precision" },
            { case: "Distributed training",       ml: "No",                                        torch: "DDP, FSDP, etc." },
            { case: "Foundation models",         ml: "Inference only (llm_load, GGUF)",           torch: "Train, fine-tune, RLHF" },
            { case: "Implementation effort",     ml: "Zero — call tools",                          torch: "Hours of LightningModule + Trainer setup" },
            { case: "Iteration speed",           ml: "Seconds (small data, no compile)",          torch: "Seconds-minutes per change (compile, GPU sync)" },
            { case: "Claude integration",        ml: "Native, MCP",                               torch: "DIY wrapper" },
          ]}
        />
        <Callout kind="warn" title="Use Lightning when">
          You're training a real model. CV, NLP at scale, generative models, multi-GPU. You need
          checkpointing, profiling, distributed strategies. You have GPU access and your data
          doesn't fit in RAM.
        </Callout>
        <Callout kind="success" title="Use ML-Labs when">
          You want to <em>not</em> write a Lightning module. Tabular / small image data. You want
          Claude to drive a one-off model in 5 minutes, not architect a 6-month research project.
        </Callout>
      </Section>

      <Section eyebrow="ML-Labs vs MLflow / Weights & Biases" title="Tracking + storage.">
        <p>
          MLflow and W&amp;B are <em>tracking</em> systems — they wrap whatever training code you
          write and log the runs. ML-Labs has tracking <em>built into the platform itself</em>; you
          don't choose to track, it just happens.
        </p>
        <Table
          columns={[
            { key: "case",     header: "Case",                                               accent: "purple" },
            { key: "ml",       header: "ML-Labs" },
            { key: "track",    header: "MLflow / W&B" },
          ]}
          rows={[
            { case: "Track every run",              ml: "Automatic — runs table",                                 track: "Wrap with mlflow.start_run()" },
            { case: "Compare runs",                 ml: "compare_runs MCP tool",                                  track: "UI side-by-side, very polished" },
            { case: "Track external Python",         ml: "Doesn't — only ML-Labs runs",                            track: "Yes — that's the entire value prop" },
            { case: "Hosted dashboard",             ml: "Local-only on :2626",                                    track: "Cloud + on-prem" },
            { case: "Team sharing",                 ml: "Manual (scp bundles)",                                    track: "Built-in" },
            { case: "Hyperparameter sweep UI",      ml: "auto_train + dashboard",                                 track: "Sweeps in W&B; complex setup but powerful" },
            { case: "Artifact storage",             ml: "SQLite (small) + ~/.neuron/registry/ (bundles)",          track: "S3-backed, scalable" },
            { case: "Cost",                         ml: "Free, local",                                            track: "Free tier or paid SaaS" },
          ]}
        />
        <Callout kind="warn" title="Use MLflow / W&B when">
          You have a team training in PyTorch / TensorFlow / JAX. You need centralised experiment
          tracking. You have lots of artifacts to store. You'd be reaching for it whether or not
          ML-Labs existed.
        </Callout>
        <Callout kind="success" title="Use ML-Labs when">
          You're a one-person team, all your training is via ML-Labs anyway, and you want zero-setup
          tracking. The dashboard's local-only Run Detail page covers most of what you'd use W&amp;B
          for at this scale.
        </Callout>
      </Section>

      <Section eyebrow="What ML-Labs doesn't replace" title="Honest scope.">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><strong>Tree-based / boosted models.</strong> Use sklearn / xgboost / lightgbm. Almost always the right tabular default.</li>
          <li><strong>CV beyond small flat MLPs.</strong> Use PyTorch / fast.ai.</li>
          <li><strong>NLP beyond featurizer.</strong> Use Hugging Face transformers, sentence-transformers.</li>
          <li><strong>Real LLM training / fine-tuning.</strong> Use llama.cpp, Axolotl, Hugging Face TRL.</li>
          <li><strong>Big distributed jobs.</strong> Use Ray, Dask, Spark.</li>
          <li><strong>Production model serving at scale.</strong> Use TorchServe, TFServing, Triton, Modal, Replicate.</li>
        </ul>
      </Section>

      <Section eyebrow="When ML-Labs is exactly right" title="The fit checklist.">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Tabular data, &lt;1M rows, &lt;200 features per row.</li>
          <li>Or small images (&lt;64×64).</li>
          <li>Or text → embeddings → MLP (LLM-as-featurizer).</li>
          <li>You want Claude to drive.</li>
          <li>Local laptop is your &ldquo;production.&rdquo;</li>
          <li>You value built-in tracking + calibration + drift over having to wire them yourself.</li>
        </ul>
        <Callout kind="learn" title="The litmus test">
          If you'd reach for sklearn + a notebook for this problem, ML-Labs is probably a good fit.
          If you'd reach for PyTorch + GPU, ML-Labs probably isn't.
        </Callout>
      </Section>

      <Section eyebrow="Combined patterns" title="Using ML-Labs alongside the others.">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><strong>ML-Labs + sklearn:</strong> Use sklearn's preprocessing in your featurize callback (StandardScaler, OneHotEncoder, etc.) Then ML-Labs trains the MLP on top.</li>
          <li><strong>ML-Labs + PyTorch:</strong> Use a pretrained PyTorch model (sentence-transformer, ResNet feature extractor) in featurize. ML-Labs trains the classification head. Best of both.</li>
          <li><strong>ML-Labs + W&amp;B:</strong> Skip ML-Labs's dashboard, dump events to W&amp;B if you want richer charts. Just shell out to wandb.log() from a script that polls the events table.</li>
        </ul>
        <Callout kind="tip">
          The featurize seam is where most integration happens. Anything you can call from TS, you
          can use as a featurizer.
        </Callout>
      </Section>
    </div>
  )
}
