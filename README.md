# PilotReady

PilotReady is being scaffolded as a premium PPL(A) learning and exam SPA backed by a REST API.

## Phase 0: PDF data ingestion

The source PDF (`ppla.pdf`) is intentionally treated as a one-time import artifact and should not be loaded by the web application at runtime.

```bash
python -m pip install -r requirements.txt
python scripts/parse_ppla_pdf.py --input ppla.pdf --output data/questions.json --pretty
```

The parser extracts the tabular columns `L.p.`, `NUMER`, `PYTANIE`, `ODP1`, `ODP2`, `ODP3`, and `ODP4` into a stable JSON structure. Because the source stores the correct answer in `ODP1`, generated records keep `correct_answer_key` as `A`; frontend and mobile API responses must shuffle answers at delivery time without changing the persisted source truth.

Use `data/questions.sample.json` for lightweight frontend/API development and tests until the full generated `data/questions.json` is needed for database seeding.

## Database schema

`database/schema.sql` defines the PostgreSQL tables required by the REST API:

- `questions` for the imported PPL(A) question bank.
- `users` for authentication and learner profiles.
- `user_progress` for autosaved answer state, attempts, and review queues.

`backend/models.py` mirrors the same schema as SQLAlchemy models for a future FastAPI backend.
